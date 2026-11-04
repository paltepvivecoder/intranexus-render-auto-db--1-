import { Router } from 'express';
import { requirePool, withTransaction } from '../db/pool.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { validateImageUpload, createPresignedUpload } from '../services/storage.js';
import { writeAudit } from '../services/audit.js';

const router = Router();

router.post('/uploads/presign', requireAuth, requireRoles('student'), async (req, res) => {
  requirePool();
  const validated = validateImageUpload(req.body?.contentType, Number(req.body?.size));
  const { photoKey, uploadUrl, contentType } = await createPresignedUpload(req.user.id, validated.contentType);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO community_upload_intents(photo_key,user_id,content_type,max_size_bytes,expires_at)
       VALUES($1,$2,$3,$4,now()+interval '15 minutes')`,
      [photoKey, req.user.id, contentType, validated.maxSize],
    );
    await writeAudit(client, { actorId: req.user.id, action: 'community.photo_upload_started', entity: 'community_upload', entityId: photoKey, changes: { contentType, maxSize: validated.maxSize } });
  });
  res.status(201).json({ photoKey, uploadUrl, contentType, maxSize: validated.maxSize, expiresInSeconds: 900 });
});

export default router;
