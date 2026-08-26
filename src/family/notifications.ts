import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from './middleware.js';
import { asyncHandler } from './asyncHandler.js';
import { promoteHeldMessages } from './threads.js';

const router = Router();

function isTruthyFlag(value: unknown): boolean {
  return value === '1' || value === 'true';
}

function parseId(raw: unknown): number | null {
  const str = String(raw);
  if (!/^\d+$/.test(str)) return null;
  const id = parseInt(str, 10);
  return Number.isInteger(id) ? id : null;
}

function shapeNotification(row: any) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkPath: row.link_path,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

// GET /api/family/notifications?unread=1 — promotes any past-due held
// messages addressed to the caller first (so "message_waiting" rows show
// up without a separate poll), then lists the caller's notifications.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    await promoteHeldMessages({ recipientUserId: user.id });

    const unreadOnly = isTruthyFlag(req.query.unread);
    const query = unreadOnly
      ? 'SELECT * FROM family_notifications WHERE user_id = $1 AND read_at IS NULL ORDER BY created_at DESC, id DESC'
      : 'SELECT * FROM family_notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC';

    const result = await pool.query(query, [user.id]);
    res.status(200).json(result.rows.map(shapeNotification));
  })
);

// POST /api/family/notifications/:id/read — idempotent; 404 if not the
// caller's own notification.
router.post(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    const notificationId = parseId(req.params.id);
    if (notificationId === null) {
      res.status(400).json({ error: 'Invalid notification id' });
      return;
    }

    const existing = await pool.query('SELECT id FROM family_notifications WHERE id = $1 AND user_id = $2', [
      notificationId,
      user.id,
    ]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    const result = await pool.query(
      'UPDATE family_notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 RETURNING *',
      [notificationId]
    );
    res.status(200).json(shapeNotification(result.rows[0]));
  })
);

// POST /api/family/notifications/read-all
router.post(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    await pool.query('UPDATE family_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [
      user.id,
    ]);
    res.status(200).json({ ok: true });
  })
);

export default router;
