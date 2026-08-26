import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './middleware.js';
import { asyncHandler } from './asyncHandler.js';
import { expireInviteIfNeeded } from './invites.js';
import { notify } from './notify.js';

const router = Router();

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days
const COOKIE_NAME = 'family_session';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

async function createSession(userId: number) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    'INSERT INTO family_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt]
  );
  return { token, expiresAt };
}

function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

// POST /api/family/auth/register — parent signup: creates the user, a new
// family, and the parent's membership; signs the caller in.
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, displayName, familyName } = req.body ?? {};

    if (!isNonEmptyString(email) || !isValidEmail(email)) {
      res.status(400).json({ error: 'A valid email is required' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }
    if (!isNonEmptyString(displayName)) {
      res.status(400).json({ error: 'Display name is required' });
      return;
    }
    if (!isNonEmptyString(familyName)) {
      res.status(400).json({ error: 'Family name is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedDisplayName = displayName.trim();
    const trimmedFamilyName = familyName.trim();

    const existing = await pool.query('SELECT id FROM family_users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Email is already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let userId: number;
    let family: { id: number; name: string };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `INSERT INTO family_users (email, password_hash, display_name, role)
         VALUES ($1, $2, $3, 'parent') RETURNING id`,
        [normalizedEmail, passwordHash, trimmedDisplayName]
      );
      userId = userResult.rows[0].id;

      const familyResult = await client.query(
        'INSERT INTO families (name, created_by) VALUES ($1, $2) RETURNING id, name',
        [trimmedFamilyName, userId]
      );
      family = familyResult.rows[0];

      await client.query(
        `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'parent')`,
        [family.id, userId]
      );

      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err?.code === '23505') {
        res.status(409).json({ error: 'Email is already registered' });
        return;
      }
      throw err;
    } finally {
      client.release();
    }

    const { token, expiresAt } = await createSession(userId);
    setSessionCookie(res, token, expiresAt);

    res.status(201).json({
      user: {
        id: userId,
        email: normalizedEmail,
        username: null,
        displayName: trimmedDisplayName,
        role: 'parent',
        ageBand: null,
      },
      family,
    });
  })
);

// POST /api/family/auth/join — child signup via invite code.
router.post(
  '/join',
  asyncHandler(async (req, res) => {
    const { code, password, username, email } = req.body ?? {};

    if (!isNonEmptyString(code)) {
      res.status(400).json({ error: 'Invite code is required' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const inviteResult = await pool.query('SELECT * FROM family_invites WHERE code = $1', [code.trim()]);
    let invite = inviteResult.rows[0];

    if (!invite) {
      res.status(410).json({ error: 'Invite code is invalid or no longer available' });
      return;
    }

    invite = await expireInviteIfNeeded(invite);

    if (invite.status !== 'pending') {
      res.status(410).json({ error: 'Invite code is invalid or no longer available' });
      return;
    }

    const finalUsername = isNonEmptyString(username) ? username.trim() : invite.suggested_username;
    if (!isNonEmptyString(finalUsername)) {
      res.status(400).json({ error: 'A username is required' });
      return;
    }

    let finalEmail: string | null = null;
    if (email !== undefined && email !== null && email !== '') {
      if (typeof email !== 'string' || !isValidEmail(email)) {
        res.status(400).json({ error: 'Email is invalid' });
        return;
      }
      finalEmail = email.trim().toLowerCase();
    }

    const usernameTaken = await pool.query('SELECT id FROM family_users WHERE username = $1', [finalUsername]);
    if (usernameTaken.rows.length > 0) {
      res.status(409).json({ error: 'Username is already taken' });
      return;
    }
    if (finalEmail) {
      const emailTaken = await pool.query('SELECT id FROM family_users WHERE email = $1', [finalEmail]);
      if (emailTaken.rows.length > 0) {
        res.status(409).json({ error: 'Email is already registered' });
        return;
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let childId: number;
    let threadId: number;
    let familyRow: { id: number; name: string };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `INSERT INTO family_users (email, username, password_hash, display_name, role, age_band)
         VALUES ($1, $2, $3, $4, 'child', $5) RETURNING id`,
        [finalEmail, finalUsername, passwordHash, invite.child_display_name, invite.child_age_band]
      );
      childId = userResult.rows[0].id;

      await client.query(
        `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'child')`,
        [invite.family_id, childId]
      );

      await client.query(
        `UPDATE family_invites SET status = 'accepted', accepted_by = $1 WHERE id = $2`,
        [childId, invite.id]
      );

      const threadResult = await client.query(
        `INSERT INTO family_threads (family_id, parent_user_id, child_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (parent_user_id, child_user_id) DO UPDATE SET family_id = EXCLUDED.family_id
         RETURNING id`,
        [invite.family_id, invite.created_by, childId]
      );
      threadId = threadResult.rows[0].id;

      const familyResult = await client.query('SELECT id, name FROM families WHERE id = $1', [invite.family_id]);
      familyRow = familyResult.rows[0];

      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err?.code === '23505') {
        res.status(409).json({ error: 'Username or email is already taken' });
        return;
      }
      throw err;
    } finally {
      client.release();
    }

    await notify(invite.created_by, {
      type: 'invite_accepted',
      title: `${invite.child_display_name} joined!`,
      body: `${invite.child_display_name} accepted your invite and is ready to talk.`,
      linkPath: `/family/thread.html?id=${threadId}`,
    });

    const { token, expiresAt } = await createSession(childId);
    setSessionCookie(res, token, expiresAt);

    res.status(201).json({
      user: {
        id: childId,
        email: finalEmail,
        username: finalUsername,
        displayName: invite.child_display_name,
        role: 'child',
        ageBand: invite.child_age_band,
      },
      family: familyRow,
    });
  })
);

// POST /api/family/auth/login — matches identifier against email or username.
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body ?? {};

    if (!isNonEmptyString(identifier) || typeof password !== 'string' || password.length === 0) {
      res.status(400).json({ error: 'identifier and password are required' });
      return;
    }

    const trimmedIdentifier = identifier.trim();
    const userResult = await pool.query(
      `SELECT u.*, m.family_id, f.name AS family_name
       FROM family_users u
       JOIN family_members m ON m.user_id = u.id
       JOIN families f ON f.id = m.family_id
       WHERE u.email = $1 OR u.username = $2
       LIMIT 1`,
      [trimmedIdentifier.toLowerCase(), trimmedIdentifier]
    );
    const user = userResult.rows[0];

    const INVALID = { error: 'Invalid credentials' };
    if (!user) {
      res.status(401).json(INVALID);
      return;
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      res.status(401).json(INVALID);
      return;
    }

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        ageBand: user.age_band,
      },
      family: { id: user.family_id, name: user.family_name },
    });
  })
);

// POST /api/family/auth/logout
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      await pool.query('DELETE FROM family_sessions WHERE token = $1', [token]);
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.status(200).json({ ok: true });
  })
);

// GET /api/family/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = res.locals.user!;
  res.status(200).json({
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    ageBand: user.ageBand,
    familyId: user.familyId,
    familyName: user.familyName,
  });
});

export default router;
