import { describe, test, expect } from 'vitest';
import { createCookieJar, jsonFetch, uniqueEmail } from './family-helpers.js';

// Postgres container + server are started via tests/global-setup.ts; the
// family schema is created by migrateFamily() at server boot.

function registerBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    email: uniqueEmail('parent'),
    password: 'correct-horse',
    displayName: 'Parent One',
    familyName: 'The Testersons',
    ...overrides,
  };
}

describe('Family auth', () => {
  test('register creates a parent, sets a session cookie, and returns 201', async () => {
    const client = createCookieJar();
    const body = registerBody();

    const { res, body: json } = await jsonFetch(client, '/api/family/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(201);
    expect(json.user.email).toBe(body.email.toLowerCase());
    expect(json.user.role).toBe('parent');
    expect(json.family.name).toBe(body.familyName);
    expect(client.cookies.has('family_session')).toBe(true);
  });

  test('duplicate email registration returns 409', async () => {
    const client = createCookieJar();
    const body = registerBody();

    const first = await jsonFetch(client, '/api/family/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(first.res.status).toBe(201);

    const secondClient = createCookieJar();
    const second = await jsonFetch(secondClient, '/api/family/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerBody({ email: body.email })),
    });
    expect(second.res.status).toBe(409);
  });

  test('weak password is rejected with 400', async () => {
    const client = createCookieJar();
    const { res } = await jsonFetch(client, '/api/family/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerBody({ password: '123' })),
    });
    expect(res.status).toBe(400);
  });

  test('login with the wrong password returns 401', async () => {
    const client = createCookieJar();
    const body = registerBody();
    await jsonFetch(client, '/api/family/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const freshClient = createCookieJar();
    const { res, body: json } = await jsonFetch(freshClient, '/api/family/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: body.email, password: 'totally-wrong' }),
    });

    expect(res.status).toBe(401);
    expect(json.error).toBeDefined();
  });

  test('login with correct credentials succeeds and sets a cookie', async () => {
    const client = createCookieJar();
    const body = registerBody();
    await jsonFetch(client, '/api/family/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const freshClient = createCookieJar();
    const { res } = await jsonFetch(freshClient, '/api/family/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: body.email, password: body.password }),
    });

    expect(res.status).toBe(200);
    expect(freshClient.cookies.has('family_session')).toBe(true);
  });

  test('GET /auth/me returns the caller with a cookie, 401 without one', async () => {
    const client = createCookieJar();
    const body = registerBody();
    await jsonFetch(client, '/api/family/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const authed = await jsonFetch(client, '/api/family/auth/me');
    expect(authed.res.status).toBe(200);
    expect(authed.body.displayName).toBe(body.displayName);
    expect(authed.body.role).toBe('parent');
    expect(authed.body.familyName).toBe(body.familyName);

    const anonymousClient = createCookieJar();
    const anon = await jsonFetch(anonymousClient, '/api/family/auth/me');
    expect(anon.res.status).toBe(401);
  });

  test('logout clears the cookie and invalidates the session', async () => {
    const client = createCookieJar();
    const body = registerBody();
    await jsonFetch(client, '/api/family/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const beforeLogout = await jsonFetch(client, '/api/family/auth/me');
    expect(beforeLogout.res.status).toBe(200);

    const logout = await jsonFetch(client, '/api/family/auth/logout', { method: 'POST' });
    expect(logout.res.status).toBe(200);

    const afterLogout = await jsonFetch(client, '/api/family/auth/me');
    expect(afterLogout.res.status).toBe(401);
  });
});
