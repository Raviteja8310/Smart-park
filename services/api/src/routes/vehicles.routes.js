import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const uuidSchema = z.string().uuid();
const vehicleSchema = z.object({
  registrationNumber: z.string().trim().min(2).max(24),
  make: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(80).nullable().optional(),
  vehicleType: z.enum(['motorcycle', 'car', 'suv', 'van', 'truck', 'other']).default('car'),
  color: z.string().trim().max(40).nullable().optional(),
  modelYear: z.number().int().min(1950).max(new Date().getFullYear() + 2).nullable().optional(),
  isDefault: z.boolean().default(false)
});
const vehicleUpdateSchema = vehicleSchema.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one vehicle field to update.');
function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function validationFail(res, parsed) { return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.'); }
async function audit(executor, actorId, action, entityId, metadata = {}) {
  await executor.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [actorId, action, 'vehicle', entityId, JSON.stringify(metadata)]);
}
function mapVehicle(row) {
  return { id: row.id, registrationNumber: row.registration_number, make: row.make ?? '', model: row.model ?? '', vehicleType: row.vehicle_type,
    color: row.color ?? '', modelYear: row.model_year === null ? null : Number(row.model_year), isDefault: Boolean(row.is_default), createdAt: row.created_at };
}
const vehicleSelect = 'SELECT id, registration_number, make, model, vehicle_type, color, model_year, is_default, created_at FROM vehicles';

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`${vehicleSelect} WHERE owner_user_id = ? ORDER BY is_default DESC, created_at DESC`, [req.user.id]);
  return res.json({ vehicles: rows.map(mapVehicle) });
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const input = parsed.data;
  const [existingRows] = await pool.execute('SELECT COUNT(*) AS count FROM vehicles WHERE owner_user_id = ?', [req.user.id]);
  if (Number(existingRows[0].count) >= 20) return fail(res, 409, 'VEHICLE_LIMIT_REACHED', 'You can save up to 20 vehicles. Remove an old vehicle before adding another.');
  const [defaultRows] = await pool.execute('SELECT id FROM vehicles WHERE owner_user_id = ? LIMIT 1', [req.user.id]);
  const isDefault = input.isDefault || defaultRows.length === 0;
  const id = randomUUID();
  const registration = input.registrationNumber.replace(/\s+/g, '').toUpperCase();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (isDefault) await connection.execute('UPDATE vehicles SET is_default = FALSE WHERE owner_user_id = ?', [req.user.id]);
    await connection.execute(
      'INSERT INTO vehicles (id, owner_user_id, registration_number, make, model, vehicle_type, color, model_year, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.user.id, registration, input.make ?? null, input.model ?? null, input.vehicleType, input.color ?? null, input.modelYear ?? null, isDefault ? 1 : 0]
    );
    await audit(connection, req.user.id, 'vehicle.created', id, { registrationNumber: registration });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'VEHICLE_EXISTS', 'A vehicle with this registration number is already registered.');
    throw error;
  } finally { connection.release(); }
  const [rows] = await pool.execute(`${vehicleSelect} WHERE id = ? LIMIT 1`, [id]);
  return res.status(201).json({ vehicle: mapVehicle(rows[0]), message: 'Vehicle added to your garage.' });
}));

router.patch('/:vehicleId', requireAuth, asyncHandler(async (req, res) => {
  const id = uuidSchema.safeParse(req.params.vehicleId);
  if (!id.success) return fail(res, 400, 'INVALID_ID', 'The vehicle identifier is invalid.');
  const parsed = vehicleUpdateSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const input = parsed.data;
  const mapping = { registrationNumber: 'registration_number', make: 'make', model: 'model', vehicleType: 'vehicle_type', color: 'color', modelYear: 'model_year', isDefault: 'is_default' };
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [found] = await connection.execute('SELECT id FROM vehicles WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE', [id.data, req.user.id]);
    if (!found.length) { await connection.rollback(); return fail(res, 404, 'VEHICLE_NOT_FOUND', 'The vehicle was not found in your garage.'); }
    if (input.isDefault) await connection.execute('UPDATE vehicles SET is_default = FALSE WHERE owner_user_id = ?', [req.user.id]);
    const updates = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) { updates.push(`${mapping[key]} = ?`); values.push(key === 'registrationNumber' ? value.replace(/\s+/g, '').toUpperCase() : value); }
    await connection.execute(`UPDATE vehicles SET ${updates.join(', ')} WHERE id = ? AND owner_user_id = ?`, [...values, id.data, req.user.id]);
    await audit(connection, req.user.id, 'vehicle.updated', id.data, { fields: Object.keys(input) });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'VEHICLE_EXISTS', 'A vehicle with this registration number is already registered.');
    throw error;
  } finally { connection.release(); }
  const [rows] = await pool.execute(`${vehicleSelect} WHERE id = ? LIMIT 1`, [id.data]);
  return res.json({ vehicle: mapVehicle(rows[0]), message: 'Vehicle details updated.' });
}));

router.delete('/:vehicleId', requireAuth, asyncHandler(async (req, res) => {
  const id = uuidSchema.safeParse(req.params.vehicleId);
  if (!id.success) return fail(res, 400, 'INVALID_ID', 'The vehicle identifier is invalid.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT id, is_default FROM vehicles WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE', [id.data, req.user.id]);
    if (!rows.length) { await connection.rollback(); return fail(res, 404, 'VEHICLE_NOT_FOUND', 'The vehicle was not found in your garage.'); }
    await connection.execute('DELETE FROM vehicles WHERE id = ?', [id.data]);
    if (rows[0].is_default) {
      const [remaining] = await connection.execute('SELECT id FROM vehicles WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 1', [req.user.id]);
      if (remaining.length) await connection.execute('UPDATE vehicles SET is_default = TRUE WHERE id = ?', [remaining[0].id]);
    }
    await audit(connection, req.user.id, 'vehicle.deleted', id.data, {});
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return fail(res, 409, 'VEHICLE_IN_USE', 'This vehicle is linked to a booking and cannot be deleted. You can still edit its details.');
    throw error;
  } finally { connection.release(); }
  return res.json({ message: 'Vehicle removed.' });
}));

export default router;
