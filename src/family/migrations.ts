import pool from '../db.js';

interface MigrationStep {
  version: number;
  sql: string;
}

// Ordered schema steps for the "Between" parent-child communication app.
// Each step runs once, inside its own transaction, tracked in
// family_schema_migrations. New steps are appended, never edited in place.
const steps: MigrationStep[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE family_users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE,
        username TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
        age_band TEXT CHECK (age_band IN ('under10', '10-12', '13plus')),
        created_at TIMESTAMPTZ DEFAULT now(),
        CHECK (email IS NOT NULL OR username IS NOT NULL)
      );

      CREATE TABLE families (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES family_users(id),
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE family_members (
        family_id INTEGER NOT NULL REFERENCES families(id),
        user_id INTEGER NOT NULL REFERENCES family_users(id),
        role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (family_id, user_id)
      );

      CREATE TABLE family_invites (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        family_id INTEGER NOT NULL REFERENCES families(id),
        created_by INTEGER NOT NULL REFERENCES family_users(id),
        child_display_name TEXT NOT NULL,
        child_age_band TEXT NOT NULL CHECK (child_age_band IN ('under10', '10-12', '13plus')),
        suggested_username TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_by INTEGER REFERENCES family_users(id),
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE family_sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES family_users(id),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE family_threads (
        id SERIAL PRIMARY KEY,
        family_id INTEGER NOT NULL REFERENCES families(id),
        parent_user_id INTEGER NOT NULL REFERENCES family_users(id),
        child_user_id INTEGER NOT NULL REFERENCES family_users(id),
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (parent_user_id, child_user_id)
      );

      CREATE TABLE family_messages (
        id SERIAL PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES family_threads(id),
        sender_id INTEGER NOT NULL REFERENCES family_users(id),
        body_original TEXT NOT NULL,
        body_final TEXT NOT NULL,
        reframe_source TEXT NOT NULL CHECK (reframe_source IN ('ai', 'template', 'none')),
        status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'delivered', 'opened', 'cancelled')),
        deliver_after TIMESTAMPTZ NOT NULL,
        delivered_at TIMESTAMPTZ,
        opened_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE family_checkins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES family_users(id),
        family_id INTEGER NOT NULL REFERENCES families(id),
        mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
        note TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE family_notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES family_users(id),
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        link_path TEXT,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `,
  },
];

export async function migrateFamily() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS family_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  const { rows } = await pool.query('SELECT version FROM family_schema_migrations');
  const applied = new Set<number>(rows.map((r: { version: number }) => r.version));

  for (const step of steps.sort((a, b) => a.version - b.version)) {
    if (applied.has(step.version)) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(step.sql);
      await client.query('INSERT INTO family_schema_migrations (version) VALUES ($1)', [step.version]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
