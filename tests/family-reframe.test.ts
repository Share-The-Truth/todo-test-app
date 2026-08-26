import { describe, test, expect, afterAll } from 'vitest';
import pg from 'pg';
import { createCookieJar, jsonFetch, createParentChildThread } from './family-helpers.js';
import { templateReframe } from '../src/family/reframe/template.js';

// Direct DB access is used for one thing only: proving the reframe endpoint
// is a pure transform that writes nothing. Mirrors tests/family-messages.test.ts.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

// The server under test inherits this process's environment (see
// tests/global-setup.ts), so this is a faithful read of which path the
// endpoint will take.
const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

const HOSTILE = 'You never listen to me!';

function templateInput(overrides: Partial<Parameters<typeof templateReframe>[0]> = {}) {
  return {
    text: HOSTILE,
    senderRole: 'parent' as const,
    recipientAgeBand: '10-12' as const,
    senderName: 'Sam',
    recipientName: 'Maya',
    ...overrides,
  };
}

async function countMessages(threadId: number): Promise<number> {
  const result = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM family_messages WHERE thread_id = $1',
    [threadId]
  );
  return result.rows[0].count;
}

// ---------------------------------------------------------------------
// Endpoint behaviour that holds whether or not an API key is configured
// ---------------------------------------------------------------------

describe('POST /api/family/reframe', () => {
  test('returns a non-empty suggestion and persists nothing', async () => {
    const fixture = await createParentChildThread();
    const before = await countMessages(fixture.threadId);

    const { res, body } = await jsonFetch(fixture.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: fixture.threadId }),
    });

    expect(res.status).toBe(200);
    expect(typeof body.reframed).toBe('string');
    expect(body.reframed.trim().length).toBeGreaterThan(0);
    expect(['ai', 'template']).toContain(body.source);

    // The whole point of this endpoint: it suggests, it does not send.
    const after = await countMessages(fixture.threadId);
    expect(after).toBe(before);
  });

  test('a non-participant gets 404, not another family’s thread', async () => {
    const fixtureA = await createParentChildThread();
    const fixtureB = await createParentChildThread();

    const { res } = await jsonFetch(fixtureB.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: fixtureA.threadId }),
    });
    expect(res.status).toBe(404);
  });

  test('unauthenticated requests are rejected with 401', async () => {
    const fixture = await createParentChildThread();
    const anon = createCookieJar();

    const { res } = await jsonFetch(anon, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: fixture.threadId }),
    });
    expect(res.status).toBe(401);
  });

  test('validation: empty text, over-long text and a bad thread id are rejected', async () => {
    const fixture = await createParentChildThread();

    const empty = await jsonFetch(fixture.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: '   ', threadId: fixture.threadId }),
    });
    expect(empty.res.status).toBe(400);

    const missing = await jsonFetch(fixture.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ threadId: fixture.threadId }),
    });
    expect(missing.res.status).toBe(400);

    const tooLong = await jsonFetch(fixture.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: 'a'.repeat(2001), threadId: fixture.threadId }),
    });
    expect(tooLong.res.status).toBe(400);

    const badThread = await jsonFetch(fixture.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: 'not-a-number' }),
    });
    expect(badThread.res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------
// The template path through the endpoint (CI runs with no API key)
// ---------------------------------------------------------------------

describe.skipIf(HAS_API_KEY)('POST /api/family/reframe without ANTHROPIC_API_KEY', () => {
  test('falls back to the deterministic template', async () => {
    const fixture = await createParentChildThread();

    const { res, body } = await jsonFetch(fixture.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: fixture.threadId }),
    });

    expect(res.status).toBe(200);
    expect(body.source).toBe('template');
    expect(body.reframed.trim().length).toBeGreaterThan(0);
    expect(body.reframed).not.toBe(HOSTILE);
  });

  test('neutralises the accusation and softens an insult', async () => {
    const fixture = await createParentChildThread();

    const accusation = await jsonFetch(fixture.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: fixture.threadId }),
    });
    expect(accusation.res.status).toBe(200);
    expect(accusation.body.reframed).toMatch(/I feel|I felt/);
    expect(accusation.body.reframed.toLowerCase()).not.toContain('never listen');

    const insult = await jsonFetch(fixture.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: 'You are so lazy and I hate it!', threadId: fixture.threadId }),
    });
    expect(insult.res.status).toBe(200);
    const softened = insult.body.reframed.toLowerCase();
    expect(softened).not.toContain('lazy');
    expect(softened).not.toContain('hate');
  });

  test('the same words are reframed differently for an under-10 and a 13plus child', async () => {
    const young = await createParentChildThread({ ageBand: 'under10' });
    const teen = await createParentChildThread({ ageBand: '13plus' });

    const forYoung = await jsonFetch(young.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: young.threadId }),
    });
    const forTeen = await jsonFetch(teen.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: teen.threadId }),
    });

    expect(forYoung.res.status).toBe(200);
    expect(forTeen.res.status).toBe(200);
    expect(forYoung.body.reframed).not.toBe(forTeen.body.reframed);
  });

  test('a child writing to a parent gets a different reframe than the parent writing back', async () => {
    const fixture = await createParentChildThread();

    const fromChild = await jsonFetch(fixture.child.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: fixture.threadId }),
    });
    const fromParent = await jsonFetch(fixture.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: fixture.threadId }),
    });

    expect(fromChild.res.status).toBe(200);
    expect(fromChild.body.source).toBe('template');
    expect(fromChild.body.reframed.trim().length).toBeGreaterThan(0);
    expect(fromChild.body.reframed).not.toBe(fromParent.body.reframed);
  });
});

// ---------------------------------------------------------------------
// The template itself: pure, deterministic, no server needed
// ---------------------------------------------------------------------

describe('templateReframe', () => {
  test('is deterministic and never returns the hostile input unchanged', () => {
    const once = templateReframe(templateInput());
    const twice = templateReframe(templateInput());
    expect(once).toBe(twice);
    expect(once.trim().length).toBeGreaterThan(0);
    expect(once).not.toBe(HOSTILE);
    expect(once).not.toContain('never listen');
  });

  test('rewrites "you never X" into a first-person statement', () => {
    const out = templateReframe(templateInput({ text: 'You never listen to me!' }));
    expect(out).toMatch(/I feel|I felt/);
    expect(out).toContain("you don't listen to me");
  });

  test('rewrites "you always X" into something that names the pattern, not the person', () => {
    const out = templateReframe(templateInput({ text: 'You always take my stuff.' }));
    expect(out.toLowerCase()).not.toContain('you always');
    expect(out).toContain('taking my stuff keeps happening');
  });

  test('strips shouting: ALL-CAPS words and repeated exclamation marks', () => {
    const out = templateReframe(templateInput({ text: 'YOU ALWAYS TAKE MY STUFF!!!' }));
    expect(out).not.toContain('!!');
    expect(out).not.toMatch(/[A-Z]{2,}/); // no remaining shouted words
    expect(out).toContain('taking my stuff');
  });

  test('softens the insult wordlist', () => {
    const cases: Array<[string, string]> = [
      ['You are being so stupid about this.', 'stupid'],
      ['You are so lazy.', 'lazy'],
      ['Shut up about it.', 'shut up'],
      ['I hate the way this went.', 'hate'],
      ['This is the worst.', 'worst'],
      ['You are such an idiot.', 'idiot'],
    ];

    for (const [text, banned] of cases) {
      const out = templateReframe(templateInput({ text })).toLowerCase();
      expect(out.length).toBeGreaterThan(0);
      expect(out, `"${banned}" survived reframing of "${text}"`).not.toContain(banned);
    }
  });

  test('each age band and each direction gets a distinct scaffold', () => {
    const variants = [
      templateReframe(templateInput({ recipientAgeBand: 'under10' })),
      templateReframe(templateInput({ recipientAgeBand: '10-12' })),
      templateReframe(templateInput({ recipientAgeBand: '13plus' })),
      templateReframe(templateInput({ senderRole: 'child', recipientAgeBand: null, senderName: 'Maya', recipientName: 'Dad' })),
    ];

    expect(new Set(variants).size).toBe(variants.length);
    for (const variant of variants) {
      expect(variant.trim().length).toBeGreaterThan(0);
    }
  });

  test('leaves a plain boundary standing instead of wrapping it in a feeling', () => {
    const out = templateReframe(
      templateInput({ text: 'No, you cannot stay out past ten. That is the rule.', recipientAgeBand: '13plus' })
    );
    expect(out).toContain('No, you cannot stay out past ten.');
    expect(out).toContain('That is the rule.');
  });

  test('always produces something, even for empty input', () => {
    const out = templateReframe(templateInput({ text: '   ' }));
    expect(out.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------
// Live API — only runs when a real key is present
// ---------------------------------------------------------------------

describe.skipIf(!HAS_API_KEY)('POST /api/family/reframe with a live Anthropic key', () => {
  test('uses the AI path and returns a non-empty rewrite', async () => {
    const fixture = await createParentChildThread();

    const { res, body } = await jsonFetch(fixture.parent.client, '/api/family/reframe', {
      method: 'POST',
      body: JSON.stringify({ text: HOSTILE, threadId: fixture.threadId }),
    });

    expect(res.status).toBe(200);
    expect(body.source).toBe('ai');
    expect(body.reframed.trim().length).toBeGreaterThan(0);
    expect(body.reframed).not.toBe(HOSTILE);
  }, 30_000);
});
