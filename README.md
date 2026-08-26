# todo-test-app

This repository holds two unrelated things side by side:

- **The todo app** (`public/index.html`, `src/server.ts` todo routes, `tests/`, `e2e/todo.spec.ts`) — a minimal Express + Postgres fixture used to exercise an E2E testing harness. It ships with one **intentional bug**: adding a todo does not update the list without a page refresh (`e2e/todo.spec.ts` marks that scenario `test.fixme` on purpose). Don't fix it — it's the fixture doing its job.
- **Between** (`public/family/`, `src/family/`) — a real feature built inside the same server: a calm, parent-managed space for parent-child conversations. Everything below describes Between.

## What Between does

Between is a small messaging app for one specific problem: a parent and a child both know something needs to be said, and the moment either of them tries, it comes out sharper than they meant. Between sits in the middle of that conversation with three mechanics:

- **Reframe my words** — before sending, either side can ask "Help me say it." The app suggests a calmer, first-person rewrite of what they typed. The sender edits it (or keeps their own words) and approves it — nothing is ever rewritten or sent automatically.
- **Sealed envelopes** — messages arrive sealed. The recipient opens them when they're ready, not the instant they're sent. The sender is told when their message has been opened.
- **Cool-down holds** — a message can be sent immediately, or held for 5, 15, or 60 minutes before it delivers. While it's held, the sender can still edit or take it back. The recipient never knows a held message exists until it actually lands.
- **Feelings check-ins** — a quick mood pick (with an optional note for older kids) that the whole family can see, so "how's everyone doing" doesn't have to wait for a hard conversation.
- **In-app notifications** — a notification center is the only delivery channel. There's no email/SMS integration; the app is the platform.

It's built for the whole family, not just one age: invites carry an age band (under 10 / 10–12 / 13+), and copy, the reframe tone, and available fields (e.g. no email requirement for young kids) adapt to it. Children under 13 don't self-register — a parent creates the family account, then invites each child with a single-use code and manages their password if they ever need a reset.

## Quickstart

```bash
npm install
export DATABASE_URL=postgresql://user:pass@localhost:5432/your_db
npm start
```

Then visit `http://localhost:3005/family/` to create a family, or `http://localhost:3005/` for the todo fixture.

The server runs both apps from the same Express process and creates its own tables on boot (todo + Between, each with their own migration runner) — no separate migration step needed.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Postgres connection string for both the todo and Between schemas. |
| `PORT` | No | `3005` | Port the server listens on. |
| `ANTHROPIC_API_KEY` | No | — | Enables AI-generated reframes. Without it (or if a call fails for any reason), Between falls back to a deterministic template rewrite — the compose screen always has a suggestion to offer, it just won't be AI-written. |
| `REFRAME_MODEL` | No | `claude-haiku-4-5` | Overrides the model used for reframing when `ANTHROPIC_API_KEY` is set. |

## Testing

- `npm test` — Vitest integration tests for the API. Boots a real Postgres via [testcontainers](https://node.testcontainers.org/), so it needs a working Docker daemon; no `DATABASE_URL` setup required, the test harness provisions its own.
- `npm run test:e2e` — Playwright end-to-end tests (`e2e/todo.spec.ts` + `e2e/family.spec.ts`), driving a real browser against the full app. This does **not** use testcontainers — it needs `DATABASE_URL` pointing at a Postgres instance it can reach, and `playwright.config.ts` boots the app server itself against that database. For example, against a local Postgres with a `test`/`test` role and a `todo_test` database already created:

  ```bash
  DATABASE_URL=postgresql://test:test@localhost:5432/todo_test npx playwright test
  ```

  The Between e2e suite creates its own accounts, families, and invites on every run (unique emails/usernames per run) and is safe to run repeatedly against a persistent, non-empty database.

## Honest MVP notes

A few corners were knowingly cut for a working MVP rather than a launch-ready product:

- **Held-message delivery is lazy, not scheduled.** A message held for "5 minutes" becomes visible to the recipient the next time either side's thread (or the notification center) is loaded after that time has passed — there's no background job ticking messages over. In practice this means delivery lands on the next page view or poll, not the literal minute mark.
- **No COPPA compliance claims.** Between is built to be age-aware and parent-managed, which is a reasonable posture for a personal/family project, but that is not the same as verifiable parental consent or a real privacy program. Don't take this as compliant for a public launch involving children's data.
- **No content-moderation or safety-escalation path.** The reframe engine softens tone; it does not detect or escalate anything like a disclosure of self-harm or abuse in a check-in note or message. That's a real gap for a family-facing product and would need a deliberate design pass, not a bolt-on filter.
