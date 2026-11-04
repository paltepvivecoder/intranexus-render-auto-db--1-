import { Router } from 'express';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { requirePool } from '../db/pool.js';

const router = Router();

router.get('/users/teachers', requireAuth, requireRoles('admin','organizer'), async (_req, res) => {
  const result = await requirePool().query(
    `SELECT id,full_name,email FROM users WHERE role='teacher' AND account_status='approved' ORDER BY full_name LIMIT 500`,
  );
  res.json({ items: result.rows });
});

router.get('/users/students', requireAuth, requireRoles('admin','organizer','teacher'), async (_req, res) => {
  const result = await requirePool().query(
    `SELECT id,full_name,enrolled_verified,tryout_passed FROM users
      WHERE role='student' AND account_status='approved'
      ORDER BY full_name LIMIT 1000`,
  );
  res.json({ items: result.rows });
});

export default router;
