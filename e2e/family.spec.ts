import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// End-to-end journeys for "Between", the parent-child communication app
// under public/family/. The dev Postgres backing this run is persistent
// across test runs, so every account/invite created here uses a unique
// suffix — never assume a clean database.

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}
function uniqueEmail(prefix: string): string {
  return `${prefix}.${uniqueSuffix()}@example.com`;
}
function uniqueUsername(prefix: string): string {
  return `${prefix}${uniqueSuffix()}`;
}

const HEATED_TEXT = 'You never listen to me!';
const EXPECTED_REFRAME =
  "I feel upset when you don't listen to me. Can we talk it through and find a fairer way, Maya?";

interface RegisteredParent {
  email: string;
  password: string;
  displayName: string;
  familyName: string;
}

// Registers a parent purely through the API (used by journeys that don't
// need to exercise the register form itself) — cookies land in `context`,
// so any Page opened from it is already signed in.
async function registerParentViaApi(context: BrowserContext, parent: RegisteredParent) {
  const res = await context.request.post('/api/family/auth/register', {
    data: {
      email: parent.email,
      password: parent.password,
      displayName: parent.displayName,
      familyName: parent.familyName,
    },
  });
  expect(res.ok(), `parent registration failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createInviteViaApi(
  context: BrowserContext,
  childDisplayName: string,
  ageBand: 'under10' | '10-12' | '13plus'
): Promise<string> {
  const res = await context.request.post('/api/family/invites', {
    data: { childDisplayName, ageBand },
  });
  expect(res.ok(), `invite creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return body.code as string;
}

async function joinViaApi(context: BrowserContext, code: string, username: string, password: string) {
  const res = await context.request.post('/api/family/auth/join', {
    data: { code, username, password },
  });
  expect(res.ok(), `join failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function findThreadId(context: BrowserContext, otherDisplayName: string): Promise<number> {
  const res = await context.request.get('/api/family/threads');
  expect(res.ok()).toBeTruthy();
  const threads = await res.json();
  const thread = threads.find((t: any) => t.otherParticipant.displayName === otherDisplayName);
  expect(thread, `no thread found with ${otherDisplayName}`).toBeTruthy();
  return thread.id as number;
}

test.describe.configure({ mode: 'serial' });

test.describe('Between — end-to-end journeys', () => {
  // Shared across journey 1 and journey 4: the invite code journey 1's
  // child actually used to join, so journey 4 can prove a used code is
  // rejected the same way a bogus or revoked one is.
  let journey1UsedCode = '';

  test('journey 1: reframe, sealed envelope, reply, notifications', async ({ browser }) => {
    test.setTimeout(60000);
    const parentContext = await browser.newContext();
    const childContext = await browser.newContext();
    const parentPage = await parentContext.newPage();
    const childPage = await childContext.newPage();

    const parentEmail = uniqueEmail('parent1');
    const parentPassword = 'parentpass123';
    const familyName = `Journey One Family ${uniqueSuffix()}`;

    await test.step('parent registers via the UI', async () => {
      await parentPage.goto('/family/register.html');
      await parentPage.getByTestId('register-name').fill('Alex Parent');
      await parentPage.getByTestId('register-email').fill(parentEmail);
      await parentPage.getByTestId('register-password').fill(parentPassword);
      await parentPage.getByTestId('register-family').fill(familyName);
      await parentPage.getByTestId('register-submit').click();
      await expect(parentPage).toHaveURL(/home\.html/);
      await expect(parentPage.getByTestId('home-content')).toBeVisible();
    });

    await test.step('home shows the invite form', async () => {
      await expect(parentPage.getByTestId('invite-form')).toBeVisible();
    });

    let inviteCode = '';
    await test.step('parent creates an invite for Maya, band 10-12', async () => {
      await parentPage.getByTestId('invite-name').fill('Maya');
      await parentPage.getByTestId('invite-band-10-12').check();
      await parentPage.getByTestId('invite-submit').click();
      const codeNode = parentPage.getByTestId('invite-code');
      await expect(codeNode).toBeVisible();
      inviteCode = ((await codeNode.textContent()) ?? '').trim();
      expect(inviteCode.length).toBeGreaterThan(0);
      journey1UsedCode = inviteCode;
    });

    await test.step('child opens the join link and joins', async () => {
      await childPage.goto(`/family/join.html?code=${encodeURIComponent(inviteCode)}`);
      await expect(childPage.getByTestId('join-panel')).toBeVisible();
      await expect(childPage.locator('#greeting')).toContainText('Maya');

      const childUsername = uniqueUsername('maya');
      await childPage.getByTestId('join-username').fill(childUsername);
      await childPage.getByTestId('join-password').fill('mayapassword1');
      await childPage.getByTestId('join-submit').click();

      await expect(childPage).toHaveURL(/home\.html/);
      await expect(childPage.locator('body')).toHaveClass(/band-10-12/);
      await expect(childPage.getByTestId('thread-card')).toBeVisible();
    });

    await test.step('parent opens the thread', async () => {
      // The parent's home view loaded before the child joined, so the new
      // thread only shows up after a fresh load.
      await parentPage.goto('/family/home.html');
      await parentPage.getByTestId('thread-card').first().click();
      await expect(parentPage).toHaveURL(/thread\.html\?id=/);
      await expect(parentPage.getByTestId('thread-title')).toBeVisible();
    });

    await test.step('parent writes heated text and gets a reframe suggestion', async () => {
      await parentPage.getByTestId('compose-text').fill(HEATED_TEXT);
      await parentPage.getByTestId('help-me-say-it').click();

      const rawText = parentPage.getByTestId('raw-text');
      const reframedText = parentPage.getByTestId('reframed-text');
      await expect(rawText).toHaveText(HEATED_TEXT);
      await expect(reframedText).toHaveValue(EXPECTED_REFRAME);
      expect(EXPECTED_REFRAME).not.toBe(HEATED_TEXT);
    });

    const editedFinal =
      "I feel upset when you don't listen to me. Can we talk it through, Maya? Love always, Dad.";
    await test.step('parent edits the suggestion and sends now', async () => {
      const reframedText = parentPage.getByTestId('reframed-text');
      await reframedText.fill(editedFinal);
      await parentPage.getByTestId('use-this').click();
      await parentPage.getByTestId('hold-0').check();
      await parentPage.getByTestId('send-message').click();
      await expect(parentPage.getByTestId('my-message').last()).toHaveText(editedFinal);
    });

    await test.step('child sees exactly one sealed envelope and never the raw text', async () => {
      await childPage.getByTestId('thread-card').first().click();
      await expect(childPage).toHaveURL(/thread\.html\?id=/);
      await childPage.reload();
      await expect(childPage.getByTestId('sealed-envelope')).toHaveCount(1);
      await expect(childPage.locator('body')).not.toContainText('never listen');
    });

    await test.step('child opens the envelope and sees the revealed message, no original-text disclosure', async () => {
      await childPage.getByTestId('sealed-envelope').click();
      await expect(childPage.getByTestId('their-message')).toHaveText(editedFinal);
      await expect(childPage.getByTestId('original-text')).toHaveCount(0);
    });

    const replyText = "Ok, I'll try to listen more. Sorry Dad.";
    await test.step('child replies via "Keep mine as-is"', async () => {
      await childPage.getByTestId('compose-text').fill(replyText);
      await childPage.getByTestId('help-me-say-it').click();
      await expect(childPage.getByTestId('reframed-text')).not.toHaveValue('');
      await childPage.getByTestId('keep-mine').click();
      await childPage.getByTestId('hold-0').check();
      await childPage.getByTestId('send-message').click();
      await expect(childPage.getByTestId('my-message').last()).toHaveText(replyText);
    });

    await test.step('parent reloads: sees the reply (sealed, same as any incoming message) and a non-zero bell count', async () => {
      await parentPage.reload();
      const replyEnvelope = parentPage.getByTestId('sealed-envelope');
      await expect(replyEnvelope).toHaveCount(1);
      const bellCount = parentPage.locator('[data-bell-count]');
      await expect(bellCount).toBeVisible();
      await expect(bellCount).not.toHaveText('0');

      await replyEnvelope.click();
      await expect(parentPage.getByTestId('their-message').last()).toHaveText(replyText);
    });

    await test.step('parent notifications show message_opened and the reply, mark-all-read zeroes the bell', async () => {
      await parentPage.goto('/family/notifications.html');
      const list = parentPage.getByTestId('notification-list');
      await expect(list).toContainText('opened your message');
      await expect(list).toContainText('sent you a message');

      await parentPage.getByTestId('mark-all-read').click();
      await expect(parentPage.locator('[data-bell-count]')).toBeHidden();
    });

    await parentContext.close();
    await childContext.close();
  });

  test.describe('shared family for hold, age-adaptation, and invite-lifecycle journeys', () => {
    let parentContext: BrowserContext;
    let childContext: BrowserContext;
    let under10Context: BrowserContext;
    let parentPage: Page;

    const parent: RegisteredParent = {
      email: uniqueEmail('parent2'),
      password: 'parentpass123',
      displayName: 'Jordan Parent',
      familyName: `Journey Two Family ${uniqueSuffix()}`,
    };

    let heldThreadId = 0;
    let heldMessageId = '';

    test.beforeAll(async ({ browser }) => {
      parentContext = await browser.newContext();
      childContext = await browser.newContext();
      under10Context = await browser.newContext();

      await registerParentViaApi(parentContext, parent);

      const code = await createInviteViaApi(parentContext, 'Sam', '13plus');
      const childUsername = uniqueUsername('sam');
      await joinViaApi(childContext, code, childUsername, 'sampassword1');

      heldThreadId = await findThreadId(parentContext, 'Sam');

      parentPage = await parentContext.newPage();
    });

    test.afterAll(async () => {
      await parentContext.close();
      await childContext.close();
      await under10Context.close();
    });

    test('journey 2: cool-down hold is invisible to the child until sent, and cancellable', async () => {
      const childPage = await childContext.newPage();

      await parentPage.goto(`/family/thread.html?id=${heldThreadId}`);
      await parentPage.getByTestId('compose-text').fill("Let's talk about the chores when things are calmer.");
      await parentPage.getByTestId('hold-5').check();
      await parentPage.getByTestId('send-message').click();

      const heldMessage = parentPage.locator('.msg.mine[data-status="held"]').last();
      await expect(heldMessage).toBeVisible();
      heldMessageId = (await heldMessage.getAttribute('data-message-id')) ?? '';
      expect(heldMessageId).not.toBe('');
      await expect(heldMessage.getByTestId('cancel-held')).toBeVisible();

      await childPage.goto(`/family/thread.html?id=${heldThreadId}`);
      await expect(childPage.getByTestId('sealed-envelope')).toHaveCount(0);

      await heldMessage.getByTestId('cancel-held').click();
      await expect(parentPage.locator(`.msg.mine[data-message-id="${heldMessageId}"]`)).toHaveAttribute(
        'data-status',
        'cancelled'
      );

      await childPage.reload();
      await expect(childPage.getByTestId('sealed-envelope')).toHaveCount(0);

      await childPage.close();
    });

    test('journey 3: age adaptation for an under-10 child', async () => {
      const code = await createInviteViaApi(parentContext, 'Jamie', 'under10');

      const under10Page = await under10Context.newPage();
      await under10Page.goto(`/family/join.html?code=${encodeURIComponent(code)}`);
      await expect(under10Page.getByTestId('join-panel')).toBeVisible();
      await expect(under10Page.locator('#email-field')).toBeHidden();

      const under10Username = uniqueUsername('jamie');
      await under10Page.getByTestId('join-username').fill(under10Username);
      await under10Page.getByTestId('join-password').fill('jamiepassword1');
      await under10Page.getByTestId('join-submit').click();

      await expect(under10Page).toHaveURL(/home\.html/);
      await expect(under10Page.locator('body')).toHaveClass(/band-under10/);

      await under10Page.getByTestId('checkin-cta').click();
      await expect(under10Page).toHaveURL(/checkin\.html/);
      await expect(under10Page.getByTestId('mood-row')).toBeVisible();
      await expect(under10Page.getByTestId('checkin-note')).toBeHidden();

      await under10Page.getByTestId('mood-5').click();
      await expect(under10Page.getByTestId('mood-5')).toHaveAttribute('aria-pressed', 'true');
      await under10Page.getByTestId('checkin-submit').click();
      await expect(under10Page).toHaveURL(/home\.html/);

      await parentPage.goto('/family/home.html');
      await expect(parentPage.getByTestId('home-content')).toContainText('Jamie');

      await parentPage.goto('/family/notifications.html');
      await expect(parentPage.getByTestId('notification-list')).toContainText('checked in');

      await under10Page.close();
    });

    test('journey 4: invite lifecycle — bogus, revoked, and used codes are all invalid', async () => {
      const page = await parentContext.newPage();

      await test.step('a bogus code is invalid', async () => {
        await page.goto('/family/join.html?code=NOTAREALCODE99');
        await expect(page.getByTestId('join-invalid')).toBeVisible();
      });

      await test.step('a revoked invite is invalid', async () => {
        const code = await createInviteViaApi(parentContext, 'Revoked Kid', '13plus');
        const revokeRes = await parentContext.request.post(
          `/api/family/invites/${encodeURIComponent(code)}/revoke`
        );
        expect(revokeRes.ok()).toBeTruthy();

        await page.goto(`/family/join.html?code=${encodeURIComponent(code)}`);
        await expect(page.getByTestId('join-invalid')).toBeVisible();
      });

      await test.step('an already-used code (from journey 1) is invalid', async () => {
        expect(journey1UsedCode).not.toBe('');
        await page.goto(`/family/join.html?code=${encodeURIComponent(journey1UsedCode)}`);
        await expect(page.getByTestId('join-invalid')).toBeVisible();
      });

      await page.close();
    });
  });
});
