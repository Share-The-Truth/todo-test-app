// Shared helpers for the family-app test suite: a tiny cookie-jar fetch
// wrapper (so tests can carry a session cookie across requests, since
// `fetch` itself does not persist cookies) plus unique email/username
// generators. The Postgres instance persists across test runs in this repo's
// harness, so uniqueness must not rely on a fresh DB.

export const BASE_URL = `http://localhost:${process.env.PORT || 3005}`;

export interface CookieJarClient {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  cookies: Map<string, string>;
}

function parseSetCookieHeader(setCookieValue: string): { name: string; value: string } | null {
  const firstPair = setCookieValue.split(';')[0];
  const eqIndex = firstPair.indexOf('=');
  if (eqIndex === -1) return null;
  return {
    name: firstPair.slice(0, eqIndex).trim(),
    value: firstPair.slice(eqIndex + 1).trim(),
  };
}

// Creates a fetch wrapper that captures Set-Cookie headers from responses
// and replays them as a Cookie header on subsequent requests, emulating a
// single browser's cookie jar for one test "session".
export function createCookieJar(): CookieJarClient {
  const cookies = new Map<string, string>();

  async function jarFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) {
      const cookieHeader = Array.from(cookies.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
      headers.set('Cookie', cookieHeader);
    }

    const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

    // getSetCookie() is the standard way to get all Set-Cookie headers
    // (a single `headers.get` would merge them into one invalid string).
    const setCookieValues =
      typeof (res.headers as any).getSetCookie === 'function' ? (res.headers as any).getSetCookie() : [];

    for (const raw of setCookieValues as string[]) {
      const parsed = parseSetCookieHeader(raw);
      if (!parsed) continue;
      // A Max-Age=0 / Expires-in-the-past cookie (clearCookie) removes it.
      if (/expires=thu, 01 jan 1970/i.test(raw) || /max-age=0/i.test(raw) || parsed.value === '') {
        cookies.delete(parsed.name);
      } else {
        cookies.set(parsed.name, parsed.value);
      }
    }

    return res;
  }

  return { fetch: jarFetch, cookies };
}

export async function jsonFetch(client: CookieJarClient, path: string, init: RequestInit = {}) {
  const res = await client.fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => undefined);
  return { res, body };
}

let counter = 0;

function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)}${counter}`;
}

export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}.${uniqueSuffix()}@example.com`;
}

export function uniqueUsername(prefix = 'user'): string {
  return `${prefix}${uniqueSuffix()}`;
}
