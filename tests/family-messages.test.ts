import { describe, test, expect, afterAll } from 'vitest';
import pg from 'pg';
import {
  createCookieJar,
  jsonFetch,
  createParentChildThread,
  type FamilyFixture,
} from './family-helpers.js';

// Direct DB access for two things the HTTP API deliberately doesn't expose:
// (1) fabricating a past-due held message to test lazy promotion without
// waiting on a real clock, and (2) sanity-checking the DB has no leaked
// content. Mirrors the pattern used in tests/family-invites.test.ts.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

async function sendMessage(fixture: FamilyFixture, sender: 'parent' | 'child', overrides: Partial<Record<string, unknown>> = {}) {
  const senderInfo = fixture[sender];
  const { res, body } = await jsonFetch(senderInfo.client, `/api/family/threads/${fixture.threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      bodyFinal: 'I feel upset when this happens.',
      reframeSource: 'none',
      holdMinutes: 0,
      ...overrides,
    }),
  });
  return { res, body };
}

describe('Family threads & messages', () => {
  test('immediate send -> recipient sees a sealed stub with no body keys -> open reveals bodyFinal only, sets openedAt, notifies the sender', async () => {
    const fixture = await createParentChildThread();

    const { res: sendRes, body: sent } = await sendMessage(fixture, 'parent', {
      bodyFinal: 'I feel hurt when plans change last minute.',
      bodyOriginal: 'You always ruin everything!',
      reframeSource: 'ai',
      holdMinutes: 0,
    });
    expect(sendRes.status).toBe(201);
    expect(sent.status).toBe('delivered');
    expect(sent.bodyOriginal).toBe('You always ruin everything!');
    expect(sent.bodyFinal).toBe('I feel hurt when plans change last minute.');

    // Recipient (child) views the thread: sealed stub, no body keys at all.
    const childThread = await jsonFetch(fixture.child.client, `/api/family/threads/${fixture.threadId}`);
    expect(childThread.res.status).toBe(200);
    const stub = childThread.body.messages.find((m: any) => m.id === sent.id);
    expect(stub).toBeDefined();
    expect(stub.sealed).toBe(true);
    expect(stub.deliveredAt).toBeDefined();
    expect('bodyFinal' in stub).toBe(false);
    expect('bodyOriginal' in stub).toBe(false);
    // Belt-and-braces: raw JSON string must never contain the sender's text.
    const rawJson = JSON.stringify(childThread.body);
    expect(rawJson).not.toContain('ruin everything');
    expect(rawJson).not.toContain('hurt when plans change');

    // Open it.
    const openRes = await jsonFetch(fixture.child.client, `/api/family/messages/${sent.id}/open`, { method: 'POST' });
    expect(openRes.res.status).toBe(200);
    expect(openRes.body.sealed).toBe(false);
    expect(openRes.body.bodyFinal).toBe('I feel hurt when plans change last minute.');
    expect('bodyOriginal' in openRes.body).toBe(false);
    expect(openRes.body.openedAt).toBeDefined();

    // Recipient never sees bodyOriginal, even after opening.
    const afterOpenThread = await jsonFetch(fixture.child.client, `/api/family/threads/${fixture.threadId}`);
    const opened = afterOpenThread.body.messages.find((m: any) => m.id === sent.id);
    expect(opened.bodyFinal).toBe('I feel hurt when plans change last minute.');
    expect('bodyOriginal' in opened).toBe(false);
    expect(JSON.stringify(afterOpenThread.body)).not.toContain('ruin everything');

    // Sender sees the full shape, including bodyOriginal, and openedAt set.
    const parentThread = await jsonFetch(fixture.parent.client, `/api/family/threads/${fixture.threadId}`);
    const senderView = parentThread.body.messages.find((m: any) => m.id === sent.id);
    expect(senderView.bodyOriginal).toBe('You always ruin everything!');
    expect(senderView.bodyFinal).toBe('I feel hurt when plans change last minute.');
    expect(senderView.status).toBe('opened');
    expect(senderView.openedAt).toBeDefined();

    // Sender was notified that the message was opened.
    const notifs = await jsonFetch(fixture.parent.client, '/api/family/notifications');
    const openedNotif = notifs.body.find((n: any) => n.type === 'message_opened' && n.linkPath?.includes(String(fixture.threadId)));
    expect(openedNotif).toBeDefined();
  });

  test('sender cannot open their own message', async () => {
    const fixture = await createParentChildThread();
    const { body: sent } = await sendMessage(fixture, 'parent');

    const { res } = await jsonFetch(fixture.parent.client, `/api/family/messages/${sent.id}/open`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('opening an already-opened message is rejected', async () => {
    const fixture = await createParentChildThread();
    const { body: sent } = await sendMessage(fixture, 'parent');

    const first = await jsonFetch(fixture.child.client, `/api/family/messages/${sent.id}/open`, { method: 'POST' });
    expect(first.res.status).toBe(200);

    const second = await jsonFetch(fixture.child.client, `/api/family/messages/${sent.id}/open`, { method: 'POST' });
    expect(second.res.status).toBe(409);
  });

  test('holdMinutes 5 -> held: invisible to recipient, visible to sender with deliverAfter; sender can edit and cancel; cancel after delivery -> 409', async () => {
    const fixture = await createParentChildThread();
    const { res: sendRes, body: sent } = await sendMessage(fixture, 'child', {
      bodyFinal: 'Can we talk later?',
      reframeSource: 'template',
      holdMinutes: 5,
    });
    expect(sendRes.status).toBe(201);
    expect(sent.status).toBe('held');
    expect(sent.deliverAfter).toBeDefined();
    expect(sent.deliveredAt).toBeNull();

    // Recipient (parent) sees nothing for it.
    const parentThread = await jsonFetch(fixture.parent.client, `/api/family/threads/${fixture.threadId}`);
    expect(parentThread.body.messages.find((m: any) => m.id === sent.id)).toBeUndefined();
    expect(JSON.stringify(parentThread.body)).not.toContain('Can we talk later');

    // No notification yet for a held message.
    const parentNotifsBefore = await jsonFetch(fixture.parent.client, '/api/family/notifications');
    expect(parentNotifsBefore.body.find((n: any) => n.type === 'message_waiting' && n.linkPath?.includes(String(fixture.threadId)))).toBeUndefined();

    // Sender can PATCH the held message's body.
    const patchRes = await jsonFetch(fixture.child.client, `/api/family/messages/${sent.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ bodyFinal: 'Can we talk later? No rush.' }),
    });
    expect(patchRes.res.status).toBe(200);
    expect(patchRes.body.bodyFinal).toBe('Can we talk later? No rush.');

    // Recipient cannot patch or cancel the sender's held message.
    const foreignPatch = await jsonFetch(fixture.parent.client, `/api/family/messages/${sent.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ bodyFinal: 'nope' }),
    });
    expect(foreignPatch.res.status).toBe(404);
    const foreignCancel = await jsonFetch(fixture.parent.client, `/api/family/messages/${sent.id}/cancel`, { method: 'POST' });
    expect(foreignCancel.res.status).toBe(404);

    // Sender cancels while held -> ok.
    const cancelRes = await jsonFetch(fixture.child.client, `/api/family/messages/${sent.id}/cancel`, { method: 'POST' });
    expect(cancelRes.res.status).toBe(200);
    expect(cancelRes.body.status).toBe('cancelled');

    // Cancelling again (now cancelled, not held) -> 409.
    const secondCancel = await jsonFetch(fixture.child.client, `/api/family/messages/${sent.id}/cancel`, { method: 'POST' });
    expect(secondCancel.res.status).toBe(409);

    // PATCH on a cancelled message -> 409.
    const patchAfterCancel = await jsonFetch(fixture.child.client, `/api/family/messages/${sent.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ bodyFinal: 'too late' }),
    });
    expect(patchAfterCancel.res.status).toBe(409);

    // A cancelled message stays invisible to the recipient.
    const parentThreadAfter = await jsonFetch(fixture.parent.client, `/api/family/threads/${fixture.threadId}`);
    expect(parentThreadAfter.body.messages.find((m: any) => m.id === sent.id)).toBeUndefined();
  });

  test('cancel after delivery returns 409', async () => {
    const fixture = await createParentChildThread();
    const { body: sent } = await sendMessage(fixture, 'parent', { holdMinutes: 0 });
    expect(sent.status).toBe('delivered');

    const cancelRes = await jsonFetch(fixture.parent.client, `/api/family/messages/${sent.id}/cancel`, { method: 'POST' });
    expect(cancelRes.res.status).toBe(409);
  });

  test('a past-due held message is promoted to delivered on the recipient GET, and a message_waiting notification is created', async () => {
    const fixture = await createParentChildThread();

    // Insert a held message directly, with deliver_after already in the past
    // (bypassing the API's holdMinutes enum on purpose to simulate time
    // having passed).
    const insertResult = await pool.query(
      `INSERT INTO family_messages (thread_id, sender_id, body_original, body_final, reframe_source, status, deliver_after)
       VALUES ($1, $2, $3, $4, 'none', 'held', now() - interval '1 minute')
       RETURNING id`,
      [fixture.threadId, fixture.parent.user.id, 'raw text', 'Past due message']
    );
    const messageId = insertResult.rows[0].id;

    // Not yet promoted in the DB.
    const before = await pool.query('SELECT status FROM family_messages WHERE id = $1', [messageId]);
    expect(before.rows[0].status).toBe('held');

    // Recipient GETs the thread -> lazy promotion kicks in.
    const childThread = await jsonFetch(fixture.child.client, `/api/family/threads/${fixture.threadId}`);
    expect(childThread.res.status).toBe(200);
    const promoted = childThread.body.messages.find((m: any) => m.id === messageId);
    expect(promoted).toBeDefined();
    expect(promoted.sealed).toBe(true);

    const after = await pool.query('SELECT status, delivered_at FROM family_messages WHERE id = $1', [messageId]);
    expect(after.rows[0].status).toBe('delivered');
    expect(after.rows[0].delivered_at).not.toBeNull();

    const notifs = await jsonFetch(fixture.child.client, '/api/family/notifications');
    const waitingNotif = notifs.body.find((n: any) => n.type === 'message_waiting' && n.linkPath === `/family/thread.html?id=${fixture.threadId}`);
    expect(waitingNotif).toBeDefined();
  });

  test('past-due held message is also promoted via the notifications GET directly (no thread GET needed)', async () => {
    const fixture = await createParentChildThread();

    const insertResult = await pool.query(
      `INSERT INTO family_messages (thread_id, sender_id, body_original, body_final, reframe_source, status, deliver_after)
       VALUES ($1, $2, $3, $4, 'none', 'held', now() - interval '1 minute')
       RETURNING id`,
      [fixture.threadId, fixture.child.user.id, 'raw text', 'Past due from child']
    );
    const messageId = insertResult.rows[0].id;

    const notifs = await jsonFetch(fixture.parent.client, '/api/family/notifications');
    expect(notifs.res.status).toBe(200);
    const waitingNotif = notifs.body.find((n: any) => n.type === 'message_waiting' && n.linkPath === `/family/thread.html?id=${fixture.threadId}`);
    expect(waitingNotif).toBeDefined();

    const after = await pool.query('SELECT status FROM family_messages WHERE id = $1', [messageId]);
    expect(after.rows[0].status).toBe('delivered');
  });

  test('a non-member cannot see or act on a thread/message -> 404', async () => {
    const fixtureA = await createParentChildThread();
    const fixtureB = await createParentChildThread();
    const { body: sent } = await sendMessage(fixtureA, 'parent');

    const threadRes = await jsonFetch(fixtureB.parent.client, `/api/family/threads/${fixtureA.threadId}`);
    expect(threadRes.res.status).toBe(404);

    const postRes = await jsonFetch(fixtureB.parent.client, `/api/family/threads/${fixtureA.threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ bodyFinal: 'intruder', reframeSource: 'none', holdMinutes: 0 }),
    });
    expect(postRes.res.status).toBe(404);

    const openRes = await jsonFetch(fixtureB.parent.client, `/api/family/messages/${sent.id}/open`, { method: 'POST' });
    expect(openRes.res.status).toBe(404);
  });

  test('unauthenticated requests are rejected with 401', async () => {
    const fixture = await createParentChildThread();
    const anon = createCookieJar();

    const listRes = await jsonFetch(anon, '/api/family/threads');
    expect(listRes.res.status).toBe(401);

    const threadRes = await jsonFetch(anon, `/api/family/threads/${fixture.threadId}`);
    expect(threadRes.res.status).toBe(401);

    const postRes = await jsonFetch(anon, `/api/family/threads/${fixture.threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ bodyFinal: 'hi', reframeSource: 'none', holdMinutes: 0 }),
    });
    expect(postRes.res.status).toBe(401);
  });

  test('validation: empty bodyFinal, bad reframeSource, and bad holdMinutes are rejected', async () => {
    const fixture = await createParentChildThread();

    const emptyBody = await jsonFetch(fixture.parent.client, `/api/family/threads/${fixture.threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ bodyFinal: '   ', reframeSource: 'none', holdMinutes: 0 }),
    });
    expect(emptyBody.res.status).toBe(400);

    const badSource = await jsonFetch(fixture.parent.client, `/api/family/threads/${fixture.threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ bodyFinal: 'hi', reframeSource: 'nope', holdMinutes: 0 }),
    });
    expect(badSource.res.status).toBe(400);

    const badHold = await jsonFetch(fixture.parent.client, `/api/family/threads/${fixture.threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ bodyFinal: 'hi', reframeSource: 'none', holdMinutes: 7 }),
    });
    expect(badHold.res.status).toBe(400);
  });

  test('GET /threads lists unopened and held counts correctly', async () => {
    const fixture = await createParentChildThread();

    await sendMessage(fixture, 'parent', { holdMinutes: 0 }); // delivered, unopened to child
    await sendMessage(fixture, 'child', { holdMinutes: 5 }); // held, sender = child

    const parentList = await jsonFetch(fixture.parent.client, '/api/family/threads');
    expect(parentList.res.status).toBe(200);
    const parentEntry = parentList.body.find((t: any) => t.id === fixture.threadId);
    expect(parentEntry.otherParticipant.displayName).toBe(fixture.child.user.displayName);
    expect(parentEntry.otherParticipant.ageBand).toBe(fixture.child.user.ageBand);
    expect(parentEntry.heldCount).toBe(0); // parent's own held messages
    expect(parentEntry.unopenedCount).toBe(0); // nothing delivered to parent yet

    const childList = await jsonFetch(fixture.child.client, '/api/family/threads');
    const childEntry = childList.body.find((t: any) => t.id === fixture.threadId);
    expect(childEntry.unopenedCount).toBe(1); // the parent's delivered message
    expect(childEntry.heldCount).toBe(1); // the child's own held message
  });
});
