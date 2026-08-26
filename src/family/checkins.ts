import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from './middleware.js';
import { asyncHandler } from './asyncHandler.js';
import { notify } from './notify.js';

const router = Router();

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// POST /api/family/checkins — mood (1-5) + optional note, visible to the
// whole family. Notifies every OTHER family member (not the checker-in).
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    const { mood, note } = req.body ?? {};

    if (typeof mood !== 'number' || !Number.isInteger(mood) || mood < 1 || mood > 5) {
      res.status(400).json({ error: 'mood must be an integer between 1 and 5' });
      return;
    }
    const trimmedNote = isNonEmptyString(note) ? note.trim() : null;

    const result = await pool.query(
      `INSERT INTO family_checkins (user_id, family_id, mood, note) VALUES ($1, $2, $3, $4) RETURNING *`,
      [user.id, user.familyId, mood, trimmedNote]
    );
    const checkin = result.rows[0];

    const membersResult = await pool.query('SELECT user_id FROM family_members WHERE family_id = $1 AND user_id <> $2', [
      user.familyId,
      user.id,
    ]);
    for (const row of membersResult.rows) {
      await notify(row.user_id, {
        type: 'checkin',
        title: `${user.displayName} checked in`,
        body: trimmedNote,
        linkPath: '/family/home.html',
      });
    }

    res.status(201).json({
      id: checkin.id,
      userId: checkin.user_id,
      displayName: user.displayName,
      role: user.role,
      mood: checkin.mood,
      note: checkin.note,
      createdAt: checkin.created_at,
    });
  })
);

// GET /api/family/checkins?days=7 — family feed, newest first. days is
// capped at 90 and defaults to 7.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;

    let days = DEFAULT_DAYS;
    const daysParam = req.query.days;
    if (typeof daysParam === 'string' && daysParam.trim() !== '') {
      const parsed = Number(daysParam);
      if (Number.isFinite(parsed) && parsed > 0) {
        days = Math.min(Math.floor(parsed), MAX_DAYS);
      }
    }

    const result = await pool.query(
      `SELECT c.id, c.user_id, u.display_name, u.role, c.mood, c.note, c.created_at
       FROM family_checkins c
       JOIN family_users u ON u.id = c.user_id
       WHERE c.family_id = $1 AND c.created_at >= now() - ($2 || ' days')::interval
       ORDER BY c.created_at DESC, c.id DESC`,
      [user.familyId, String(days)]
    );

    res.status(200).json(
      result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        displayName: row.display_name,
        role: row.role,
        mood: row.mood,
        note: row.note,
        createdAt: row.created_at,
      }))
    );
  })
);

export default router;
