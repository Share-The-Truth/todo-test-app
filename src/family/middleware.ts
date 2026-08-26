import type { NextFunction, Request, Response } from 'express';
import pool from '../db.js';

export const AGE_BANDS = ['under10', '10-12', '13plus'] as const;

export interface AuthedUser {
  id: number;
  email: string | null;
  username: string | null;
  displayName: string;
  role: 'parent' | 'child';
  ageBand: string | null;
  familyId: number;
  familyName: string;
}

declare module 'express-serve-static-core' {
  interface Locals {
    user?: AuthedUser;
  }
}

// requireAuth reads the family_session cookie, looks up an unexpired
// session, and loads the user (plus their family) onto res.locals.user.
// Expired sessions are lazily deleted on lookup. 401 when missing/invalid.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.family_session;
  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const sessionResult = await pool.query(
    'SELECT user_id, expires_at FROM family_sessions WHERE token = $1',
    [token]
  );
  const session = sessionResult.rows[0];

  if (!session) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    // Lazy cleanup of expired sessions.
    await pool.query('DELETE FROM family_sessions WHERE token = $1', [token]);
    res.status(401).json({ error: 'Session expired' });
    return;
  }

  const userResult = await pool.query(
    `SELECT u.id, u.email, u.username, u.display_name, u.role, u.age_band,
            m.family_id, f.name AS family_name
     FROM family_users u
     JOIN family_members m ON m.user_id = u.id
     JOIN families f ON f.id = m.family_id
     WHERE u.id = $1`,
    [session.user_id]
  );
  const row = userResult.rows[0];

  if (!row) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  res.locals.user = {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    ageBand: row.age_band,
    familyId: row.family_id,
    familyName: row.family_name,
  };

  next();
}

// requireParent must run after requireAuth. 403 for children.
export function requireParent(req: Request, res: Response, next: NextFunction) {
  if (!res.locals.user || res.locals.user.role !== 'parent') {
    res.status(403).json({ error: 'Parent access required' });
    return;
  }
  next();
}
