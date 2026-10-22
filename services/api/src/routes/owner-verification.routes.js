import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const uuidSchema = z.string().uuid();
const applicationSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  contactPhone: z.string().trim().min(7).max(30),
  propertyRelationship: z.enum(['owner','tenant_authorized','manager_authorized','business_representative']),
  documentType: z.enum(['government_id','business_registration','property_proof','authorization_letter']),
  documentReferenceLast4: z.string().trim().regex(/^\d{4}$/).optional().or(z.literal('')),
  declarationAccepted: z.literal(true)
}).strict();
const reviewSchema = z.object({ decision: z.enum(['approve','reject']), note: z.string().trim().max(1000).optional().default('') }).superRefine((v, ctx) => {
  if (v.decision === 'reject' && v.note.length < 8) ctx.addIssue({ code: 'custom', message: 'Provide a clear rejection reason of at least 8 characters.', path: ['note'] });
});
function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function mapRow(row) { return { id: row.id, userId: row.user_id, fullName: row.full_name, email: row.email, legalName: row.legal_name, contactPhone: row.contact_phone, propertyRelationship: row.property_relationship, documentType: row.document_type, documentReferenceLast4: row.document_reference_last4 ?? null, status: row.status, reviewerNote: row.reviewer_note ?? null, reviewedAt: row.reviewed_at ?? null, createdAt: row.created_at }; }
const selectSql = `SELECT v.*, u.full_name, u.email FROM owner_verification_requests v JOIN users u ON u.id = v.user_id`;
async function audit(executor, actorId, action, requestId, metadata = {}) {
  await executor.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [actorId, action, 'owner_verification', requestId, JSON.stringify(metadata)]);
}

router.get('/mine', requireAuth, requireRole('host','admin'), asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`${selectSql} WHERE v.user_id = ? ORDER BY v.created_at DESC LIMIT 1`, [req.user.id]);
  const latest = rows[0] ? mapRow(rows[0]) : null;
  return res.json({ application: latest, verified: latest?.status === 'approved' });
}));

router.post('/submit', requireAuth, requireRole('host','admin'), asyncHandler(async (req, res) => {
  const parsed = applicationSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted verification details.');
  const connection = await pool.getConnection();
  const id = randomUUID();
  const value = parsed.data;
  try {
    await connection.beginTransaction();
    // Serialize submissions per account so rapid duplicate requests cannot create two pending applications.
    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    const [pending] = await connection.execute("SELECT id FROM owner_verification_requests WHERE user_id = ? AND status = 'pending' LIMIT 1", [req.user.id]);
    if (pending.length) {
      await connection.rollback();
      return fail(res, 409, 'VERIFICATION_ALREADY_PENDING', 'You already have an owner verification application under review.');
    }
    await connection.execute(`INSERT INTO owner_verification_requests (id,user_id,legal_name,contact_phone,property_relationship,document_type,document_reference_last4,declaration_accepted,status)
      VALUES (?,?,?,?,?,?,?,TRUE,'pending')`, [id, req.user.id, value.legalName, value.contactPhone, value.propertyRelationship, value.documentType, value.documentReferenceLast4 || null]);
    await audit(connection, req.user.id, 'owner_verification.submitted', id, { documentType: value.documentType, propertyRelationship: value.propertyRelationship });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
  return res.status(201).json({ message: 'Owner verification submitted for administrator review.', applicationId: id, status: 'pending' });
}));

router.get('/admin', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const status = ['pending','approved','rejected','all'].includes(String(req.query.status ?? 'pending')) ? String(req.query.status ?? 'pending') : 'pending';
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
  const where = status === 'all' ? '' : ' WHERE v.status = ?';
  const params = status === 'all' ? [limit] : [status, limit];
  const [rows] = await pool.execute(`${selectSql}${where} ORDER BY CASE v.status WHEN 'pending' THEN 0 ELSE 1 END, v.created_at DESC LIMIT ?`, params);
  return res.json({ applications: rows.map(mapRow) });
}));

router.post('/admin/:requestId/review', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = uuidSchema.safeParse(req.params.requestId);
  if (!id.success) return fail(res, 400, 'INVALID_ID', 'The verification request identifier is invalid.');
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the review decision.');
  const approved = parsed.data.decision === 'approve';
  const note = approved ? (parsed.data.note || null) : parsed.data.note;
  const [result] = await pool.execute(`UPDATE owner_verification_requests SET status = ?, reviewer_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP()
    WHERE id = ? AND status = 'pending'`, [approved ? 'approved' : 'rejected', note, req.user.id, id.data]);
  if (result.affectedRows !== 1) return fail(res, 409, 'VERIFICATION_ALREADY_RESOLVED', 'This verification request was already reviewed or no longer exists. Refresh the queue.');
  await audit(pool, req.user.id, approved ? 'owner_verification.approved' : 'owner_verification.rejected', id.data, { note });
  return res.json({ message: approved ? 'Owner verification approved.' : 'Owner verification rejected.', status: approved ? 'approved' : 'rejected', reviewerNote: note });
}));

export default router;
