import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import pool from '../db.js';
import { requireAuth, requireParent, AGE_BANDS } from './middleware.js';
import { asyncHandler } from './asyncHandler.js';

const router = Router();
const childrenRouter = Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Unambiguous alphabet: excludes 0/O/1/I/l, per the plan.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' + 'abcdefghijkmnopqrstuvwxyz' + '23456789';
const CODE_LENGTH = 8;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function generateInviteCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

// Lazily flips a fetched pending invite to 'expired' once its expires_at has
// passed, mirroring the held-message promotion pattern used elsewhere.
export async function expireInviteIfNeeded<T extends { id: number; status: string; expires_at: string | Date }>(
  invite: T
): Promise<T> {
  if (invite.status === 'pending' && new Date(invite.expires_at).getTime() <= Date.now()) {
    await pool.query(`UPDATE family_invites SET status = 'expired' WHERE id = $1`, [invite.id]);
    invite.status = 'expired';
  }
  return invite;
}

function inviteShape(row: any) {
  return {
    code: row.code,
    childDisplayName: row.child_display_name,
    ageBand: row.child_age_band,
    suggestedUsername: row.suggested_username,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

// POST /api/family/invites — parent creates an invite code for a child.
router.post(
  '/',
  requireAuth,
  requireParent,
  asyncHandler(async (req, res) => {
    const { childDisplayName, ageBand, suggestedUsername } = req.body ?? {};

    if (!isNonEmptyString(childDisplayName)) {
      res.status(400).json({ error: 'childDisplayName is required' });
      return;
    }
    if (!AGE_BANDS.includes(ageBand)) {
      res.status(400).json({ error: `ageBand must be one of ${AGE_BANDS.join(', ')}` });
      return;
    }

    const trimmedSuggested = isNonEmptyString(suggestedUsername) ? suggestedUsername.trim() : null;
    const user = res.locals.user!;
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    let invite: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode();
      try {
        const result = await pool.query(
          `INSERT INTO family_invites (code, family_id, created_by, child_display_name, child_age_band, suggested_username, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [code, user.familyId, user.id, childDisplayName.trim(), ageBand, trimmedSuggested, expiresAt]
        );
        invite = result.rows[0];
        break;
      } catch (err: any) {
        if (err?.code === '23505' && attempt < 4) continue;
        throw err;
      }
    }

    if (!invite) {
      res.status(500).json({ error: 'Could not generate a unique invite code' });
      return;
    }

    res.status(201).json({
      ...inviteShape(invite),
      joinUrl: '/family/join.html?code=' + invite.code,
    });
  })
);

// GET /api/family/invites — list this parent's family invites.
router.get(
  '/',
  requireAuth,
  requireParent,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;

    await pool.query(
      `UPDATE family_invites SET status = 'expired' WHERE family_id = $1 AND status = 'pending' AND expires_at <= now()`,
      [user.familyId]
    );

    const result = await pool.query(
      'SELECT * FROM family_invites WHERE family_id = $1 ORDER BY created_at DESC',
      [user.familyId]
    );

    res.status(200).json(result.rows.map(inviteShape));
  })
);

// POST /api/family/invites/:code/revoke — parent revokes a pending invite.
router.post(
  '/:code/revoke',
  requireAuth,
  requireParent,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    const { code } = req.params;

    const result = await pool.query('SELECT * FROM family_invites WHERE code = $1 AND family_id = $2', [
      code,
      user.familyId,
    ]);
    let invite = result.rows[0];

    if (!invite) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    invite = await expireInviteIfNeeded(invite);

    if (invite.status !== 'pending') {
      res.status(410).json({ error: 'Invite is no longer pending' });
      return;
    }

    const updateResult = await pool.query(
      `UPDATE family_invites SET status = 'revoked' WHERE id = $1 RETURNING *`,
      [invite.id]
    );

    res.status(200).json(inviteShape(updateResult.rows[0]));
  })
);

// GET /api/family/invites/:code — PUBLIC lookup used by the join page.
router.get(
  '/:code',
  asyncHandler(async (req, res) => {
    const { code } = req.params;

    const result = await pool.query(
      `SELECT i.*, f.name AS family_name
       FROM family_invites i
       JOIN families f ON f.id = i.family_id
       WHERE i.code = $1`,
      [code]
    );
    let invite = result.rows[0];

    if (!invite) {
      res.status(410).json({ error: 'Invite code is invalid or no longer available' });
      return;
    }

    invite = await expireInviteIfNeeded(invite);

    if (invite.status !== 'pending') {
      res.status(410).json({ error: 'Invite code is invalid or no longer available' });
      return;
    }

    res.status(200).json({
      childDisplayName: invite.child_display_name,
      ageBand: invite.child_age_band,
      familyName: invite.family_name,
      suggestedUsername: invite.suggested_username,
    });
  })
);

// POST /api/family/children/:id/reset-password — parent resets a child's
// password. The child must belong to the caller's family (404 otherwise).
childrenRouter.post(
  '/:id/reset-password',
  requireAuth,
  requireParent,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    const childId = parseInt(String(req.params.id), 10);
    const { newPassword } = req.body ?? {};

    if (!Number.isInteger(childId)) {
      res.status(400).json({ error: 'Invalid child id' });
      return;
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const childResult = await pool.query(
      `SELECT u.id FROM family_users u
       JOIN family_members m ON m.user_id = u.id
       WHERE u.id = $1 AND m.family_id = $2 AND u.role = 'child'`,
      [childId, user.familyId]
    );

    if (childResult.rows.length === 0) {
      res.status(404).json({ error: 'Child not found in your family' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE family_users SET password_hash = $1 WHERE id = $2', [passwordHash, childId]);
    await pool.query('DELETE FROM family_sessions WHERE user_id = $1', [childId]);

    res.status(200).json({ ok: true });
  })
);

export default router;
export { childrenRouter };
