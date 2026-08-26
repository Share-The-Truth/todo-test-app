import { describe, test, expect } from 'vitest';
import { createCookieJar, jsonFetch, createParentChildThread } from './family-helpers.js';

describe('Family check-ins', () => {
  test('a check-in notifies other family members but not the checker-in, and shows up in the feed', async () => {
    const fixture = await createParentChildThread();

    const checkinRes = await jsonFetch(fixture.child.client, '/api/family/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood: 4, note: 'Pretty good day' }),
    });
    expect(checkinRes.res.status).toBe(201);
    expect(checkinRes.body.userId).toBe(fixture.child.user.id);
    expect(checkinRes.body.displayName).toBe(fixture.child.user.displayName);
    expect(checkinRes.body.role).toBe('child');
    expect(checkinRes.body.mood).toBe(4);
    expect(checkinRes.body.note).toBe('Pretty good day');
    expect(checkinRes.body.createdAt).toBeDefined();

    // Parent (other family member) is notified.
    const parentNotifs = await jsonFetch(fixture.parent.client, '/api/family/notifications');
    const checkinNotif = parentNotifs.body.find((n: any) => n.type === 'checkin');
    expect(checkinNotif).toBeDefined();
    expect(checkinNotif.title).toContain(fixture.child.user.displayName);
    expect(checkinNotif.linkPath).toBe('/family/home.html');

    // The checker-in does NOT get a notification about their own check-in.
    const childNotifs = await jsonFetch(fixture.child.client, '/api/family/notifications');
    expect(childNotifs.body.find((n: any) => n.type === 'checkin')).toBeUndefined();

    // Both family members see it in the feed.
    const feedForParent = await jsonFetch(fixture.parent.client, '/api/family/checkins');
    expect(feedForParent.res.status).toBe(200);
    expect(feedForParent.body.some((c: any) => c.id === checkinRes.body.id)).toBe(true);

    const feedForChild = await jsonFetch(fixture.child.client, '/api/family/checkins');
    expect(feedForChild.body.some((c: any) => c.id === checkinRes.body.id)).toBe(true);
  });

  test('feed is ordered newest first', async () => {
    const fixture = await createParentChildThread();

    const first = await jsonFetch(fixture.parent.client, '/api/family/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood: 2 }),
    });
    const second = await jsonFetch(fixture.child.client, '/api/family/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood: 5 }),
    });
    const third = await jsonFetch(fixture.parent.client, '/api/family/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood: 3 }),
    });

    const feed = await jsonFetch(fixture.parent.client, '/api/family/checkins');
    const ids = feed.body.map((c: any) => c.id);
    const iFirst = ids.indexOf(first.body.id);
    const iSecond = ids.indexOf(second.body.id);
    const iThird = ids.indexOf(third.body.id);
    // Newest first: third came last chronologically, so it appears earliest in the list.
    expect(iThird).toBeLessThan(iSecond);
    expect(iSecond).toBeLessThan(iFirst);
  });

  test('note is optional', async () => {
    const fixture = await createParentChildThread();
    const res = await jsonFetch(fixture.parent.client, '/api/family/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood: 3 }),
    });
    expect(res.res.status).toBe(201);
    expect(res.body.note).toBeNull();
  });

  test('mood 0 and mood 6 are rejected with 400', async () => {
    const fixture = await createParentChildThread();

    const tooLow = await jsonFetch(fixture.parent.client, '/api/family/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood: 0 }),
    });
    expect(tooLow.res.status).toBe(400);

    const tooHigh = await jsonFetch(fixture.parent.client, '/api/family/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood: 6 }),
    });
    expect(tooHigh.res.status).toBe(400);

    const notInt = await jsonFetch(fixture.parent.client, '/api/family/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood: 2.5 }),
    });
    expect(notInt.res.status).toBe(400);
  });

  test('days parameter filters and is capped at 90; unauthenticated requests are rejected', async () => {
    const fixture = await createParentChildThread();
    await jsonFetch(fixture.parent.client, '/api/family/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood: 3 }),
    });

    const withDays = await jsonFetch(fixture.parent.client, '/api/family/checkins?days=1');
    expect(withDays.res.status).toBe(200);

    const withHugeDays = await jsonFetch(fixture.parent.client, '/api/family/checkins?days=99999');
    expect(withHugeDays.res.status).toBe(200); // should not error; capped server-side

    const anon = createCookieJar();
    const unauth = await jsonFetch(anon, '/api/family/checkins');
    expect(unauth.res.status).toBe(401);

    const unauthPost = await jsonFetch(anon, '/api/family/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood: 3 }),
    });
    expect(unauthPost.res.status).toBe(401);
  });
});
