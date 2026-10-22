import { Router } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';
import { createNotification } from '../services/notifications.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const uuidSchema = z.string().uuid();
const createDeviceSchema = z.object({ parkingLotId: uuidSchema, deviceName: z.string().trim().min(2).max(120), provider: z.string().trim().min(2).max(80), externalDeviceId: z.string().trim().max(180).optional().nullable(), supportsEntry: z.boolean().default(true), supportsExit: z.boolean().default(true) });
const updateDeviceSchema = z.object({ deviceName: z.string().trim().min(2).max(120).optional(), deviceStatus: z.enum(['configured','offline','disabled']).optional(), supportsEntry: z.boolean().optional(), supportsExit: z.boolean().optional() }).refine((body) => Object.keys(body).length > 0, 'Provide a field to update.');
const commandSchema = z.object({ commandType: z.enum(['open','close','status_check']), reason: z.string().trim().min(10).max(500) });
const resultSchema = z.object({ status: z.enum(['succeeded','failed']), externalReference: z.string().trim().max(180).optional().nullable(), message: z.string().trim().max(500).optional().nullable(), result: z.record(z.unknown()).optional() });

function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function secureEqual(a, b) { if (!a || !b) return false; const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function requireDeviceService(req, res, next) {
  if (!env.GATE_DEVICE_SERVICE_TOKEN) return fail(res, 503, 'GATE_SERVICE_NOT_CONFIGURED', 'Configure GATE_DEVICE_SERVICE_TOKEN before connecting a physical gate adapter.');
  const supplied = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!secureEqual(supplied, env.GATE_DEVICE_SERVICE_TOKEN)) return fail(res, 401, 'GATE_SERVICE_UNAUTHORIZED', 'The gate service credential is invalid.');
  return next();
}
function lotScope(user, alias = 'l') {
  if (user.roles.includes('admin')) return { sql: '', params: [] };
  const clauses = [];
  const params = [];
  if (user.roles.includes('host')) { clauses.push(`${alias}.owner_user_id=?`); params.push(user.id); }
  const assignments = ['operator','attendant'].filter((role) => user.roles.includes(role));
  if (assignments.length) {
    clauses.push(`EXISTS (SELECT 1 FROM parking_lot_staff pls WHERE pls.parking_lot_id=${alias}.id AND pls.user_id=? AND pls.assignment_role IN (${assignments.map(() => '?').join(',')}))`);
    params.push(user.id, ...assignments);
  }
  return clauses.length ? { sql: ` AND (${clauses.join(' OR ')})`, params } : { sql: ' AND 1=0', params: [] };
}
async function lotAccess(executor, lotId, user, manage = false) {
  if (user.roles.includes('admin')) return true;
  const scope = lotScope(user, 'l');
  if (!scope.sql || scope.sql === ' AND 1=0') return false;
  if (manage && !user.roles.includes('host') && !user.roles.includes('operator')) return false;
  const [rows] = await executor.execute(`SELECT l.id FROM parking_lots l WHERE l.id=?${scope.sql} LIMIT 1`, [lotId, ...scope.params]);
  return rows.length > 0;
}
async function getDevice(executor, id) {
  const [rows] = await executor.execute(`SELECT d.*,l.name AS parking_lot_name,l.owner_user_id FROM gate_devices d JOIN parking_lots l ON l.id=d.parking_lot_id WHERE d.id=? LIMIT 1`, [id]);
  return rows[0] ?? null;
}
async function audit(executor, actorId, action, entityType, entityId, metadata = {}) {
  await executor.execute('INSERT INTO audit_logs (actor_user_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?)', [actorId ?? null,action,entityType,entityId ?? null,JSON.stringify(metadata)]);
}
function mapDevice(row) { return { id: row.id, parkingLotId: row.parking_lot_id, parkingLotName: row.parking_lot_name, deviceName: row.device_name, provider: row.provider, externalDeviceId: row.external_device_id, deviceStatus: row.device_status, supportsEntry: Boolean(row.supports_entry), supportsExit: Boolean(row.supports_exit), lastSeenAt: row.last_seen_at, createdAt: row.created_at }; }
function mapCommand(row) { return { id: row.id, gateDeviceId: row.gate_device_id, deviceName: row.device_name, parkingLotId: row.parking_lot_id, parkingLotName: row.parking_lot_name, commandType: row.command_type, reason: row.reason, status: row.status, externalReference: row.external_reference, failureMessage: row.failure_message, expiresAt: row.expires_at, dispatchedAt: row.dispatched_at, completedAt: row.completed_at, createdAt: row.created_at }; }

router.get('/devices', requireAuth, requireRole('host','operator','attendant','admin'), asyncHandler(async (req, res) => {
  const scope = lotScope(req.user, 'l');
  const [rows] = await pool.execute(`SELECT d.*,l.name AS parking_lot_name FROM gate_devices d JOIN parking_lots l ON l.id=d.parking_lot_id WHERE 1=1${scope.sql} ORDER BY d.created_at DESC LIMIT 200`, scope.params);
  return res.json({ devices: rows.map(mapDevice), hardwareServiceConfigured: Boolean(env.GATE_DEVICE_SERVICE_TOKEN) });
}));

router.post('/devices', requireAuth, requireRole('host','operator','admin'), asyncHandler(async (req, res) => {
  const parsed = createDeviceSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the gate device details.');
  const input = parsed.data;
  if (!await lotAccess(pool, input.parkingLotId, req.user, true)) return fail(res, 403, 'FACILITY_ACCESS_DENIED', 'You can configure gate devices only for a facility you own or are assigned to operate.');
  const [lots] = await pool.execute("SELECT id FROM parking_lots WHERE id=? AND facility_status IN ('active','pending_approval','draft') LIMIT 1", [input.parkingLotId]);
  if (!lots.length) return fail(res, 404, 'FACILITY_NOT_FOUND', 'The selected facility was not found.');
  const id = randomUUID();
  try {
    await pool.execute(`INSERT INTO gate_devices (id,parking_lot_id,device_name,provider,external_device_id,device_status,supports_entry,supports_exit,created_by_user_id) VALUES (?,?,?,?,?,'configured',?,?,?)`, [id,input.parkingLotId,input.deviceName,input.provider,input.externalDeviceId || null,input.supportsEntry,input.supportsExit,req.user.id]);
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return fail(res, 409, 'DEVICE_REFERENCE_EXISTS', 'That provider and external device identifier are already registered.');
    throw error;
  }
  await audit(pool,req.user.id,'gate_device.created','gate_device',id,{parkingLotId:input.parkingLotId,provider:input.provider});
  const device = await getDevice(pool,id);
  return res.status(201).json({ device: mapDevice(device), message: 'Gate device registered. It is not physically active until a compatible edge adapter connects.' });
}));

router.patch('/devices/:deviceId', requireAuth, requireRole('host','operator','admin'), asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.deviceId);
  const parsed = updateDeviceSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res,400,'INVALID_ID','The gate device identifier is invalid.');
  if (!parsed.success) return fail(res,400,'VALIDATION_ERROR',parsed.error.issues[0]?.message ?? 'Check the requested device update.');
  const device = await getDevice(pool,parsedId.data);
  if (!device || !await lotAccess(pool,device.parking_lot_id,req.user,true)) return fail(res,404,'DEVICE_NOT_FOUND','The device was not found for a facility you can manage.');
  const fields = { deviceName: 'device_name', deviceStatus: 'device_status', supportsEntry: 'supports_entry', supportsExit: 'supports_exit' };
  const updates = []; const values = [];
  for (const [key,value] of Object.entries(parsed.data)) { updates.push(`${fields[key]}=?`); values.push(value); }
  await pool.execute(`UPDATE gate_devices SET ${updates.join(',')} WHERE id=?`,[...values,device.id]);
  await audit(pool,req.user.id,'gate_device.updated','gate_device',device.id,{fields:Object.keys(parsed.data)});
  return res.json({ device: mapDevice(await getDevice(pool,device.id)), message: 'Gate device settings updated.' });
}));

router.post('/devices/:deviceId/commands', requireAuth, requireRole('host','operator','attendant','admin'), asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.deviceId);
  const parsed = commandSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res,400,'INVALID_ID','The gate device identifier is invalid.');
  if (!parsed.success) return fail(res,400,'VALIDATION_ERROR',parsed.error.issues[0]?.message ?? 'Provide a command and operational reason.');
  if (!env.GATE_DEVICE_SERVICE_TOKEN) return fail(res,503,'GATE_SERVICE_NOT_CONFIGURED','Configure GATE_DEVICE_SERVICE_TOKEN and connect a compatible adapter before queuing physical gate commands.');
  const device = await getDevice(pool,parsedId.data);
  if (!device || !await lotAccess(pool,device.parking_lot_id,req.user,false)) return fail(res,404,'DEVICE_NOT_FOUND','The gate device was not found for a facility you can access.');
  if (device.device_status === 'disabled') return fail(res,409,'DEVICE_UNAVAILABLE','This gate device is disabled.');
  if (parsed.data.commandType !== 'status_check' && device.device_status !== 'online') return fail(res,409,'DEVICE_NOT_ONLINE','Entry/exit commands require a current adapter heartbeat. Send a status check first.');
  if (parsed.data.commandType === 'open' && !device.supports_entry) return fail(res,409,'ENTRY_UNSUPPORTED','This device is not configured to control entry.');
  if (parsed.data.commandType === 'close' && !device.supports_exit) return fail(res,409,'EXIT_UNSUPPORTED','This device is not configured to control exit.');
  const id = randomUUID();
  await pool.execute(`INSERT INTO gate_device_commands (id,gate_device_id,parking_lot_id,requested_by_user_id,command_type,reason,status,expires_at) VALUES (?,?,?,?,?,?,'queued',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND))`, [id,device.id,device.parking_lot_id,req.user.id,parsed.data.commandType,parsed.data.reason]);
  await audit(pool,req.user.id,'gate_device.command_queued','gate_device_command',id,{deviceId:device.id,commandType:parsed.data.commandType,reason:parsed.data.reason});
  return res.status(202).json({ command: { id, deviceId: device.id, commandType: parsed.data.commandType, status: 'queued', expiresInSeconds: 60 }, message: 'Command queued for the configured gate adapter. SmartPark has not directly activated physical hardware.' });
}));

router.get('/commands/mine', requireAuth, requireRole('host','operator','attendant','admin'), asyncHandler(async (req, res) => {
  const scope = lotScope(req.user,'l');
  const [rows] = await pool.execute(`SELECT c.*,d.device_name,l.name AS parking_lot_name FROM gate_device_commands c JOIN gate_devices d ON d.id=c.gate_device_id JOIN parking_lots l ON l.id=c.parking_lot_id WHERE 1=1${scope.sql} ORDER BY c.created_at DESC LIMIT 100`,scope.params);
  return res.json({ commands: rows.map(mapCommand) });
}));

router.get('/service/commands', requireDeviceService, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.query.deviceId);
  if (!parsedId.success) return fail(res,400,'INVALID_DEVICE_ID','Provide a valid registered device identifier.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [devices] = await connection.execute("SELECT id,device_status FROM gate_devices WHERE id=? LIMIT 1 FOR UPDATE",[parsedId.data]);
    if (!devices.length || devices[0].device_status === 'disabled') { await connection.rollback(); return fail(res,404,'DEVICE_UNAVAILABLE','The device was not found or is disabled.'); }
    await connection.execute("UPDATE gate_devices SET device_status='online',last_seen_at=UTC_TIMESTAMP(3) WHERE id=?",[parsedId.data]);
    await connection.execute("UPDATE gate_device_commands SET status='expired',failure_message='Command expired before delivery',completed_at=UTC_TIMESTAMP(3) WHERE gate_device_id=? AND status='queued' AND expires_at<=UTC_TIMESTAMP(3)",[parsedId.data]);
    const [commands] = await connection.execute("SELECT id,command_type,reason,expires_at FROM gate_device_commands WHERE gate_device_id=? AND status='queued' AND expires_at>UTC_TIMESTAMP(3) ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED",[parsedId.data]);
    for (const command of commands) await connection.execute("UPDATE gate_device_commands SET status='dispatched',dispatched_at=UTC_TIMESTAMP(3) WHERE id=? AND status='queued'",[command.id]);
    await connection.commit();
    return res.json({ deviceId: parsedId.data, commands: commands.map((command) => ({ id:command.id, type:command.command_type, reason:command.reason, expiresAt:command.expires_at })), polledAt:new Date().toISOString() });
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}));

router.post('/service/commands/:commandId/result', requireDeviceService, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.commandId);
  const parsed = resultSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res,400,'INVALID_ID','The command identifier is invalid.');
  if (!parsed.success) return fail(res,400,'VALIDATION_ERROR',parsed.error.issues[0]?.message ?? 'Provide the hardware result.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT c.*,d.device_name,l.name AS lot_name,l.owner_user_id FROM gate_device_commands c JOIN gate_devices d ON d.id=c.gate_device_id JOIN parking_lots l ON l.id=c.parking_lot_id WHERE c.id=? LIMIT 1 FOR UPDATE',[parsedId.data]);
    const command = rows[0];
    if (!command) { await connection.rollback(); return fail(res,404,'COMMAND_NOT_FOUND','The gate command was not found.'); }
    if (command.status === parsed.data.status) { await connection.commit(); return res.json({ success:true,idempotent:true,status:command.status }); }
    if (command.status !== 'dispatched') { await connection.rollback(); return fail(res,409,'COMMAND_STATE_CONFLICT','Only a dispatched command can receive a hardware result.'); }
    await connection.execute('UPDATE gate_device_commands SET status=?,external_reference=?,failure_message=?,response_payload=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?', [parsed.data.status,parsed.data.externalReference || null,parsed.data.status==='failed' ? (parsed.data.message || 'Hardware adapter reported failure') : null,JSON.stringify(parsed.data.result ?? {}),command.id]);
    await connection.execute('UPDATE gate_devices SET last_seen_at=UTC_TIMESTAMP(3),device_status=\'online\' WHERE id=?',[command.gate_device_id]);
    await audit(connection,null,`gate_device.command_${parsed.data.status}`,'gate_device_command',command.id,{deviceId:command.gate_device_id,externalReference:parsed.data.externalReference || null,message:parsed.data.message || null});
    if (parsed.data.status === 'failed') {
      const alertId = randomUUID();
      await connection.execute(`INSERT INTO operational_alerts (id,fingerprint,parking_lot_id,source_type,source_id,alert_type,severity,title,message,status,condition_active) VALUES (?,?,?,'system',?,'gate_command_failed','critical',?,?, 'open',TRUE) ON DUPLICATE KEY UPDATE last_seen_at=UTC_TIMESTAMP(3),status='open',condition_active=TRUE,severity='critical',message=VALUES(message)`, [alertId,`gate-command:${command.id}`,command.parking_lot_id,command.id,'Gate hardware command failed',`${command.device_name} at ${command.lot_name} reported: ${parsed.data.message || 'no failure detail supplied'}`]);
      if (command.owner_user_id) await createNotification(connection,{userId:command.owner_user_id,eventType:'operations.gate_command_failed',title:'Gate command failed',message:`${command.device_name} at ${command.lot_name} could not complete a ${command.command_type} command.`});
    }
    await connection.commit();
    return res.json({ success:true,commandId:command.id,status:parsed.data.status });
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}));

export default router;
