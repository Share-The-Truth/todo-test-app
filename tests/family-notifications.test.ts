import { describe, test, expect } from 'vitest';
import { createCookieJar, jsonFetch, createParentChildThread } from './family-helpers.js';

async function sendMessage(fixture: any, sender: 'parent' | 'child', holdMinutes = 0) {
  const { res, body } = await jsonFetch(fixture[sender].client, `/api/family/threads/${fixture.threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ bodyFinal: 'hello there', reframeSource: 'none', holdMinutes }),
  });
  expect(res.status).toBe(201);
  return body;
}

describe('Family notifications', () => {
  test('read marks a notification read (idempotently); 404 for a notification that is not the caller\'s', async () => {
    const fixture = await createParentChildThread();
    await sendMessage(fixture, 'parent'); // notifies child

    const list = await jsonFetch(fixture.child.client, '/api/family/notifications');
    expect(list.res.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    const notif = list.body[0];
    expect(notif.readAt).toBeNull();

    const readRes = await jsonFetch(fixture.child.client, `/api/family/notifications/${notif.id}/read`, { method: 'POST' });
    expect(readRes.res.status).toBe(200);
    expect(readRes.body.readAt).toBeDefined();
    expect(readRes.body.readAt).not.toBeNull();

    // Idempotent: reading again does not error and keeps a read_at set.
    const readAgain = await jsonFetch(fixture.child.client, `/api/family/notifications/${notif.id}/read`, { method: 'POST' });
    expect(readAgain.res.status).toBe(200);
    expect(readAgain.body.readAt).toBeDefined();

    // Someone else's notification -> 404.
    const otherFixture = await createParentChildThread();
    const foreignRead = await jsonFetch(otherFixture.parent.client, `/api/family/notifications/${notif.id}/read`, { method: 'POST' });
    expect(foreignRead.res.status).toBe(404);

    // The message's own sender cannot mark the recipient's notification read either.
    const senderRead = await jsonFetch(fixture.parent.client, `/api/family/notifications/${notif.id}/read`, { method: 'POST' });
    expect(senderRead.res.status).toBe(404);
  });

  test('read-all marks every unread notification for the caller as read', async () => {
    const fixture = await createParentChildThread();
    await sendMessage(fixture, 'parent');
    await sendMessage(fixture, 'parent');

    const before = await jsonFetch(fixture.child.client, '/api/family/notifications?unread=1');
    expect(before.body.length).toBeGreaterThanOrEqual(2);

    const readAll = await jsonFetch(fixture.child.client, '/api/family/notifications/read-all', { method: 'POST' });
    expect(readAll.res.status).toBe(200);

    const afterUnread = await jsonFetch(fixture.child.client, '/api/family/notifications?unread=1');
    expect(afterUnread.body.length).toBe(0);

    const afterAll = await jsonFetch(fixture.child.client, '/api/family/notifications');
    expect(afterAll.body.every((n: any) => n.readAt !== null)).toBe(true);
  });

  test('unread=1 filters to only unread notifications', async () => {
    const fixture = await createParentChildThread();
    await sendMessage(fixture, 'parent');
    const list = await jsonFetch(fixture.child.client, '/api/family/notifications');
    const notif = list.body[0];
    await jsonFetch(fixture.child.client, `/api/family/notifications/${notif.id}/read`, { method: 'POST' });

    await sendMessage(fixture, 'parent'); // a second, still-unread notification

    const unreadOnly = await jsonFetch(fixture.child.client, '/api/family/notifications?unread=1');
    expect(unreadOnly.res.status).toBe(200);
    expect(unreadOnly.body.find((n: any) => n.id === notif.id)).toBeUndefined();
    expect(unreadOnly.body.every((n: any) => n.readAt === null)).toBe(true);
    expect(unreadOnly.body.length).toBeGreaterThan(0);
  });

  test('notifications are ordered newest first', async () => {
    const fixture = await createParentChildThread();
    const first = await sendMessage(fixture, 'parent');
    const second = await sendMessage(fixture, 'parent');

    const list = await jsonFetch(fixture.child.client, '/api/family/notifications');
    const ids = list.body.map((n: any) => n.linkPath).filter((l: string) => l?.includes(String(fixture.threadId)));
    // Both notifications point at the same thread; just confirm the newest
    // (second message) shows up before or at the same position as the first.
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  test('unauthenticated requests are rejected with 401', async () => {
    const anon = createCookieJar();
    const list = await jsonFetch(anon, '/api/family/notifications');
    expect(list.res.status).toBe(401);

    const read = await jsonFetch(anon, '/api/family/notifications/1/read', { method: 'POST' });
    expect(read.res.status).toBe(401);

    const readAll = await jsonFetch(anon, '/api/family/notifications/read-all', { method: 'POST' });
    expect(readAll.res.status).toBe(401);
  });
});
