import { describe, test, expect, afterAll } from 'vitest';
import pg from 'pg';
import { createCookieJar, jsonFetch, uniqueEmail, uniqueUsername, type CookieJarClient } from './family-helpers.js';

// Direct DB access to verify side effects (membership rows, thread rows,
// notification rows) that Phase 1 does not yet expose over HTTP — mirrors
// the "insert via direct pg query" pattern used elsewhere in this harness.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

async function registerParent(overrides: Partial<Record<string, unknown>> = {}) {
  const client = createCookieJar();
  const body = {
    email: uniqueEmail('parent'),
    password: 'correct-horse',
    displayName: 'Test Parent',
    familyName: 'The Testersons',
    ...overrides,
  };
  const { res, body: json } = await jsonFetch(client, '/api/family/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return { client, body, user: json.user, family: json.family };
}

async function createInvite(
  parentClient: CookieJarClient,
  overrides: Partial<Record<string, unknown>> = {}
) {
  const { res, body } = await jsonFetch(parentClient, '/api/family/invites', {
    method: 'POST',
    body: JSON.stringify({
      childDisplayName: 'Maya',
      ageBand: '10-12',
      ...overrides,
    }),
  });
  expect(res.status).toBe(201);
  return body;
}

async function joinFamily(code: string, overrides: Partial<Record<string, unknown>> = {}) {
  const client = createCookieJar();
  const body = {
    code,
    password: 'kid-password-1',
    username: uniqueUsername('kid'),
    ...overrides,
  };
  const { res, body: json } = await jsonFetch(client, '/api/family/auth/join', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return { res, json, client, body };
}

describe('Family invites', () => {
  test('a child cannot create invites', async () => {
    const { client: parentClient } = await registerParent();
    const invite = await createInvite(parentClient);
    const { client: childClient } = await joinFamily(invite.code);

    const { res } = await jsonFetch(childClient, '/api/family/invites', {
      method: 'POST',
      body: JSON.stringify({ childDisplayName: 'Sibling', ageBand: 'under10' }),
    });

    expect(res.status).toBe(403);
  });

  test('public invite lookup returns the child name and age band without auth', async () => {
    const { client: parentClient, family } = await registerParent();
    const invite = await createInvite(parentClient, { suggestedUsername: 'maya123' });

    const anonymousClient = createCookieJar();
    const { res, body } = await jsonFetch(anonymousClient, `/api/family/invites/${invite.code}`);

    expect(res.status).toBe(200);
    expect(body.childDisplayName).toBe('Maya');
    expect(body.ageBand).toBe('10-12');
    expect(body.familyName).toBe(family.name);
    expect(body.suggestedUsername).toBe('maya123');
  });

  test('joining creates the child, membership, a thread, and notifies the parent', async () => {
    const { client: parentClient, user: parentUser, family } = await registerParent();
    const invite = await createInvite(parentClient, { childDisplayName: 'River', ageBand: 'under10' });

    const { res, json, client: childClient } = await joinFamily(invite.code);
    expect(res.status).toBe(201);
    expect(json.user.role).toBe('child');
    expect(json.user.displayName).toBe('River');
    expect(json.user.ageBand).toBe('under10');
    expect(json.family.id).toBe(family.id);

    const me = await jsonFetch(childClient, '/api/family/auth/me');
    expect(me.res.status).toBe(200);
    expect(me.body.familyId).toBe(family.id);

    const membership = await pool.query(
      'SELECT role FROM family_members WHERE family_id = $1 AND user_id = $2',
      [family.id, json.user.id]
    );
    expect(membership.rows).toHaveLength(1);
    expect(membership.rows[0].role).toBe('child');

    const thread = await pool.query(
      'SELECT id FROM family_threads WHERE parent_user_id = $1 AND child_user_id = $2',
      [parentUser.id, json.user.id]
    );
    expect(thread.rows).toHaveLength(1);

    const notification = await pool.query(
      `SELECT type, link_path FROM family_notifications WHERE user_id = $1 AND type = 'invite_accepted' ORDER BY id DESC LIMIT 1`,
      [parentUser.id]
    );
    expect(notification.rows).toHaveLength(1);
    expect(notification.rows[0].link_path).toBe(`/family/thread.html?id=${thread.rows[0].id}`);
  });

  test('a second join attempt with the same code returns 410', async () => {
    const { client: parentClient } = await registerParent();
    const invite = await createInvite(parentClient);

    const firstJoin = await joinFamily(invite.code);
    expect(firstJoin.res.status).toBe(201);

    const secondJoin = await joinFamily(invite.code);
    expect(secondJoin.res.status).toBe(410);
  });

  test('a revoked invite cannot be joined', async () => {
    const { client: parentClient } = await registerParent();
    const invite = await createInvite(parentClient);

    const revoke = await jsonFetch(parentClient, `/api/family/invites/${invite.code}/revoke`, {
      method: 'POST',
    });
    expect(revoke.res.status).toBe(200);

    const attempt = await joinFamily(invite.code);
    expect(attempt.res.status).toBe(410);
  });

  test('a nonexistent code is rejected on join and on public lookup', async () => {
    const bogusCode = 'ZZZZ9999';

    const joinAttempt = await joinFamily(bogusCode);
    expect([404, 410]).toContain(joinAttempt.res.status);

    const anonymousClient = createCookieJar();
    const lookup = await jsonFetch(anonymousClient, `/api/family/invites/${bogusCode}`);
    expect([404, 410]).toContain(lookup.res.status);
  });

  test('a parent can reset a child password; old password stops working, new one works', async () => {
    const { client: parentClient } = await registerParent();
    const invite = await createInvite(parentClient);
    const { json, body: joinBody } = await joinFamily(invite.code);
    expect(joinBody.username).toBeDefined();

    const reset = await jsonFetch(parentClient, `/api/family/children/${json.user.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'brand-new-password' }),
    });
    expect(reset.res.status).toBe(200);

    const oldLoginClient = createCookieJar();
    const oldLogin = await jsonFetch(oldLoginClient, '/api/family/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: joinBody.username, password: joinBody.password }),
    });
    expect(oldLogin.res.status).toBe(401);

    const newLoginClient = createCookieJar();
    const newLogin = await jsonFetch(newLoginClient, '/api/family/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: joinBody.username, password: 'brand-new-password' }),
    });
    expect(newLogin.res.status).toBe(200);
  });

  test('a parent from a different family cannot reset a child that is not theirs', async () => {
    const { client: parentAClient } = await registerParent();
    const invite = await createInvite(parentAClient);
    const { json: childJson } = await joinFamily(invite.code);

    const { client: parentBClient } = await registerParent();

    const reset = await jsonFetch(parentBClient, `/api/family/children/${childJson.user.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'brand-new-password' }),
    });
    expect(reset.res.status).toBe(404);
  });
});
