import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const uuidSchema = z.string().uuid();
const companySchema = z.object({ name: z.string().trim().min(2).max(160), registrationNumber: z.string().trim().max(80).optional().nullable(), billingEmail: z.string().trim().email().max(254), billingPhone: z.string().trim().max(30).optional().nullable(), billingAddress: z.string().trim().max(500).optional().nullable() });
const memberSchema = z.object({ email: z.string().trim().email().max(254), role: z.enum(['manager','employee','driver']).default('employee') });
const fleetSchema = z.object({ registrationNumber: z.string().trim().min(2).max(24), make: z.string().trim().max(80).optional().nullable(), model: z.string().trim().max(80).optional().nullable(), vehicleType: z.enum(['motorcycle','car','suv','van','truck','other']).default('car'), assignedEmail: z.string().trim().email().optional().nullable() });
function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function validationFail(res, parsed) { return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.'); }
function isAdmin(user) { return user.roles?.includes('admin'); }
async function canManageAccount(accountId, user, executor = pool) {
  if (isAdmin(user)) return true;
  const [rows] = await executor.execute(`SELECT ca.id FROM corporate_accounts ca LEFT JOIN corporate_members cm ON cm.corporate_account_id = ca.id AND cm.user_id = ? AND cm.status = 'active' WHERE ca.id = ? AND ca.status = 'active' AND (ca.created_by_user_id = ? OR cm.member_role = 'manager') LIMIT 1`, [user.id, accountId, user.id]);
  return rows.length > 0;
}
async function audit(executor, actorId, action, entityId, metadata = {}) {
  await executor.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [actorId, action, 'corporate_fleet', entityId ?? null, JSON.stringify(metadata)]);
}
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`SELECT ca.*, CASE WHEN ca.created_by_user_id = ? THEN 'owner' ELSE cm.member_role END AS my_role, (SELECT COUNT(*) FROM corporate_members allm WHERE allm.corporate_account_id = ca.id AND allm.status = 'active') AS member_count, (SELECT COUNT(*) FROM corporate_fleet_vehicles fv WHERE fv.corporate_account_id = ca.id AND fv.status = 'active') AS fleet_count FROM corporate_accounts ca LEFT JOIN corporate_members cm ON cm.corporate_account_id = ca.id AND cm.user_id = ? AND cm.status = 'active' WHERE ca.created_by_user_id = ? OR cm.user_id IS NOT NULL ORDER BY ca.created_at DESC`, [req.user.id, req.user.id, req.user.id]);
  return res.json({ companies: rows.map((r) => ({ id:r.id, name:r.name, registrationNumber:r.registration_number, billingEmail:r.billing_email, billingPhone:r.billing_phone, billingAddress:r.billing_address, status:r.status, myRole:r.my_role, memberCount:Number(r.member_count), fleetCount:Number(r.fleet_count), createdAt:r.created_at })) });
}));
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const parsed = companySchema.safeParse(req.body); if (!parsed.success) return validationFail(res, parsed);
  const input = parsed.data; const id = randomUUID(); const connection = await pool.getConnection();
  try { await connection.beginTransaction();
    await connection.execute('INSERT INTO corporate_accounts (id,name,registration_number,billing_email,billing_phone,billing_address,created_by_user_id) VALUES (?,?,?,?,?,?,?)', [id,input.name,input.registrationNumber || null,input.billingEmail,input.billingPhone || null,input.billingAddress || null,req.user.id]);
    await connection.execute("INSERT INTO corporate_members (id,corporate_account_id,user_id,member_role,status) VALUES (?,?,?,'manager','active')", [randomUUID(),id,req.user.id]);
    await audit(connection,req.user.id,'corporate.created',id,{name:input.name}); await connection.commit();
  } catch(error) { await connection.rollback().catch(()=>{}); throw error; } finally { connection.release(); }
  return res.status(201).json({ company:{id,name:input.name,registrationNumber:input.registrationNumber || null,billingEmail:input.billingEmail,status:'active',myRole:'owner',memberCount:1,fleetCount:0}, message:'Corporate account created.' });
}));
router.get('/:companyId/members', requireAuth, asyncHandler(async (req,res)=>{
  const parsedId=uuidSchema.safeParse(req.params.companyId); if(!parsedId.success) return fail(res,400,'INVALID_ID','The company identifier is invalid.');
  if(!await canManageAccount(parsedId.data,req.user)) { const [member] = await pool.execute("SELECT id FROM corporate_members WHERE corporate_account_id=? AND user_id=? AND status='active'",[parsedId.data,req.user.id]); if(!member.length) return fail(res,403,'FORBIDDEN','You are not a member of this corporate account.'); }
  const [rows]=await pool.execute(`SELECT cm.id,cm.member_role,cm.status,cm.created_at,u.id AS user_id,u.full_name,u.email FROM corporate_members cm JOIN users u ON u.id=cm.user_id WHERE cm.corporate_account_id=? ORDER BY FIELD(cm.member_role,'manager','employee','driver'),u.full_name`,[parsedId.data]);
  return res.json({members:rows.map(r=>({id:r.id,userId:r.user_id,fullName:r.full_name,email:r.email,role:r.member_role,status:r.status,joinedAt:r.created_at}))});
}));
router.post('/:companyId/members', requireAuth, asyncHandler(async(req,res)=>{
  const parsedId=uuidSchema.safeParse(req.params.companyId); if(!parsedId.success) return fail(res,400,'INVALID_ID','The company identifier is invalid.');
  const parsed=memberSchema.safeParse(req.body); if(!parsed.success) return validationFail(res,parsed);
  if(!await canManageAccount(parsedId.data,req.user)) return fail(res,403,'FORBIDDEN','Only company owners, managers, or administrators can add members.');
  const [accounts]=await pool.execute("SELECT id FROM corporate_accounts WHERE id=? AND status='active'",[parsedId.data]); if(!accounts.length) return fail(res,404,'COMPANY_NOT_FOUND','The corporate account was not found or is inactive.');
  const [users]=await pool.execute('SELECT id FROM users WHERE email=? AND account_status=\'active\' LIMIT 1',[parsed.data.email]); if(!users.length) return fail(res,404,'USER_NOT_FOUND','No active SmartPark account was found for that email. Ask them to register first.');
  const id=randomUUID();
  try { await pool.execute("INSERT INTO corporate_members (id,corporate_account_id,user_id,member_role,status) VALUES (?,?,?,?,'active') ON DUPLICATE KEY UPDATE member_role=VALUES(member_role),status='active'",[id,parsedId.data,users[0].id,parsed.data.role]); }
  catch(error){if(error.code==='ER_NO_REFERENCED_ROW_2') return fail(res,400,'INVALID_MEMBER','The selected account is invalid.'); throw error;}
  await audit(pool,req.user.id,'corporate.member.added',parsedId.data,{memberUserId:users[0].id,role:parsed.data.role});
  return res.status(201).json({message:'Corporate member added.',userId:users[0].id,role:parsed.data.role});
}));
router.get('/:companyId/fleet', requireAuth, asyncHandler(async(req,res)=>{
  const parsedId=uuidSchema.safeParse(req.params.companyId); if(!parsedId.success) return fail(res,400,'INVALID_ID','The company identifier is invalid.');
  const [member]=await pool.execute("SELECT id FROM corporate_members WHERE corporate_account_id=? AND user_id=? AND status='active'",[parsedId.data,req.user.id]);
  const [owner]=await pool.execute('SELECT id FROM corporate_accounts WHERE id=? AND created_by_user_id=? AND status=\'active\'', [parsedId.data,req.user.id]);
  if(!member.length&&!owner.length&&!isAdmin(req.user)) return fail(res,403,'FORBIDDEN','You are not a member of this corporate account.');
  const [rows]=await pool.execute(`SELECT fv.*,u.full_name AS assigned_name,u.email AS assigned_email FROM corporate_fleet_vehicles fv LEFT JOIN users u ON u.id=fv.assigned_user_id WHERE fv.corporate_account_id=? ORDER BY fv.created_at DESC`,[parsedId.data]);
  return res.json({vehicles:rows.map(r=>({id:r.id,registrationNumber:r.registration_number,make:r.make,model:r.model,vehicleType:r.vehicle_type,status:r.status,assignedUserId:r.assigned_user_id,assignedName:r.assigned_name,assignedEmail:r.assigned_email,createdAt:r.created_at}))});
}));
router.post('/:companyId/fleet', requireAuth, asyncHandler(async(req,res)=>{
  const parsedId=uuidSchema.safeParse(req.params.companyId); if(!parsedId.success) return fail(res,400,'INVALID_ID','The company identifier is invalid.');
  const parsed=fleetSchema.safeParse(req.body); if(!parsed.success) return validationFail(res,parsed);
  if(!await canManageAccount(parsedId.data,req.user)) return fail(res,403,'FORBIDDEN','Only company owners, managers, or administrators can manage fleet vehicles.');
  let assignedUserId=null;
  if(parsed.data.assignedEmail){const [users]=await pool.execute("SELECT u.id FROM users u JOIN corporate_members cm ON cm.user_id=u.id AND cm.corporate_account_id=? AND cm.status='active' WHERE u.email=? LIMIT 1",[parsedId.data,parsed.data.assignedEmail]); if(!users.length) return fail(res,400,'ASSIGNEE_NOT_MEMBER','The assigned employee must be an active member of this company.'); assignedUserId=users[0].id;}
  const id=randomUUID(); const registration=parsed.data.registrationNumber.replace(/\s+/g,'').toUpperCase();
  try { await pool.execute("INSERT INTO corporate_fleet_vehicles (id,corporate_account_id,assigned_user_id,registration_number,make,model,vehicle_type,created_by_user_id) VALUES (?,?,?,?,?,?,?,?)",[id,parsedId.data,assignedUserId,registration,parsed.data.make||null,parsed.data.model||null,parsed.data.vehicleType,req.user.id]); }
  catch(error){if(error.code==='ER_DUP_ENTRY') return fail(res,409,'FLEET_VEHICLE_EXISTS','That registration number is already registered in a SmartPark fleet.'); throw error;}
  await audit(pool,req.user.id,'corporate.fleet_vehicle.added',id,{companyId:parsedId.data,registrationNumber:registration});
  return res.status(201).json({vehicle:{id,registrationNumber:registration,make:parsed.data.make||null,model:parsed.data.model||null,vehicleType:parsed.data.vehicleType,status:'active',assignedUserId},message:'Fleet vehicle added.'});
}));
router.patch('/:companyId/fleet/:vehicleId/status', requireAuth, asyncHandler(async(req,res)=>{
  const companyId=uuidSchema.safeParse(req.params.companyId), vehicleId=uuidSchema.safeParse(req.params.vehicleId); if(!companyId.success||!vehicleId.success) return fail(res,400,'INVALID_ID','The company or vehicle identifier is invalid.');
  const parsed=z.object({status:z.enum(['active','maintenance','retired'])}).safeParse(req.body); if(!parsed.success) return validationFail(res,parsed);
  if(!await canManageAccount(companyId.data,req.user)) return fail(res,403,'FORBIDDEN','You cannot manage this fleet.');
  const [result]=await pool.execute('UPDATE corporate_fleet_vehicles SET status=? WHERE id=? AND corporate_account_id=?',[parsed.data.status,vehicleId.data,companyId.data]);
  if(!result.affectedRows) return fail(res,404,'FLEET_VEHICLE_NOT_FOUND','The fleet vehicle was not found.');
  await audit(pool,req.user.id,'corporate.fleet_vehicle.status_changed',vehicleId.data,{status:parsed.data.status});
  return res.json({message:'Fleet vehicle status updated.',status:parsed.data.status});
}));
export default router;
