import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from './middleware.js';
import { asyncHandler } from './asyncHandler.js';
import { notify } from './notify.js';

const threadsRouter = Router();
const messagesRouter = Router();

const HOLD_MINUTES_OPTIONS = [0, 5, 15, 60] as const;
const REFRAME_SOURCES = ['ai', 'template', 'none'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseId(raw: unknown): number | null {
  const str = String(raw);
  if (!/^\d+$/.test(str)) return null;
  const id = parseInt(str, 10);
  return Number.isInteger(id) ? id : null;
}

// ---------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------

interface MessageRow {
  id: number;
  thread_id: number;
  sender_id: number;
  body_original: string;
  body_final: string;
  reframe_source: string;
  status: string;
  deliver_after: string | Date;
  delivered_at: string | Date | null;
  opened_at: string | Date | null;
  created_at: string | Date;
}

// Full shape — only ever shown to the message's own sender.
function senderShape(m: MessageRow) {
  return {
    id: m.id,
    senderId: m.sender_id,
    bodyOriginal: m.body_original,
    bodyFinal: m.body_final,
    reframeSource: m.reframe_source,
    status: m.status,
    deliverAfter: m.deliver_after,
    deliveredAt: m.delivered_at,
    openedAt: m.opened_at,
    createdAt: m.created_at,
  };
}

// Shape for the *other* participant (the recipient). Held/cancelled
// messages belonging to the other party are never shown to the recipient
// at all — callers should filter those out before rendering a thread.
// Delivered-but-unopened messages are sealed stubs carrying no body text;
// bodyOriginal is never exposed to the recipient, even once opened.
function recipientShape(m: MessageRow): Record<string, unknown> | null {
  if (m.status === 'delivered') {
    return { id: m.id, senderId: m.sender_id, sealed: true, deliveredAt: m.delivered_at };
  }
  if (m.status === 'opened') {
    return {
      id: m.id,
      senderId: m.sender_id,
      sealed: false,
      status: m.status,
      bodyFinal: m.body_final,
      deliveredAt: m.delivered_at,
      openedAt: m.opened_at,
      createdAt: m.created_at,
    };
  }
  // 'held' or 'cancelled' by the other party: invisible to the recipient.
  return null;
}

function shapeMessageForViewer(m: MessageRow, viewerId: number): Record<string, unknown> | null {
  return m.sender_id === viewerId ? senderShape(m) : recipientShape(m);
}

// ---------------------------------------------------------------------
// Held-message promotion (lazy — no cron)
// ---------------------------------------------------------------------

interface PromotedRow {
  id: number;
  thread_id: number;
  sender_id: number;
  parent_user_id: number;
  child_user_id: number;
}

export type PromoteScope = { threadId: number } | { recipientUserId: number };

// Promotes past-due held messages to 'delivered' and notifies their
// recipients (type 'message_waiting'). Runs lazily at the top of thread
// GETs (scoped to one thread) and the notifications GET (scoped to
// everything addressed to the caller) — delivery lands on the next read
// after deliver_after, per the plan (no cron needed for an MVP).
export async function promoteHeldMessages(scope: PromoteScope): Promise<void> {
  const whereExtra =
    'threadId' in scope
      ? 'm.thread_id = $1'
      : '(t.parent_user_id = $1 OR t.child_user_id = $1) AND m.sender_id <> $1';
  const param = 'threadId' in scope ? scope.threadId : scope.recipientUserId;

  const result = await pool.query<PromotedRow>(
    `UPDATE family_messages m
     SET status = 'delivered', delivered_at = now()
     FROM family_threads t
     WHERE m.thread_id = t.id
       AND m.status = 'held'
       AND m.deliver_after <= now()
       AND ${whereExtra}
     RETURNING m.id, m.thread_id, m.sender_id, t.parent_user_id, t.child_user_id`,
    [param]
  );

  if (result.rows.length === 0) return;

  const senderIds = Array.from(new Set(result.rows.map((r) => r.sender_id)));
  const namesResult = await pool.query<{ id: number; display_name: string }>(
    'SELECT id, display_name FROM family_users WHERE id = ANY($1::int[])',
    [senderIds]
  );
  const nameById = new Map(namesResult.rows.map((r) => [r.id, r.display_name]));

  for (const row of result.rows) {
    const recipientId = row.sender_id === row.parent_user_id ? row.child_user_id : row.parent_user_id;
    const senderName = nameById.get(row.sender_id) ?? 'Someone';
    await notify(recipientId, {
      type: 'message_waiting',
      title: `${senderName} sent you a message`,
      linkPath: `/family/thread.html?id=${row.thread_id}`,
    });
  }
}

// ---------------------------------------------------------------------
// Thread / message lookup helpers (membership enforced here — anything
// outside the caller's reach comes back null, which callers turn into 404)
// ---------------------------------------------------------------------

interface ThreadRow {
  id: number;
  family_id: number;
  parent_user_id: number;
  child_user_id: number;
  created_at: string | Date;
}

async function getThreadForParticipant(threadId: number, userId: number): Promise<ThreadRow | null> {
  const result = await pool.query<ThreadRow>(
    'SELECT * FROM family_threads WHERE id = $1 AND (parent_user_id = $2 OR child_user_id = $2)',
    [threadId, userId]
  );
  return result.rows[0] ?? null;
}

function otherParticipantId(thread: ThreadRow, userId: number): number {
  return thread.parent_user_id === userId ? thread.child_user_id : thread.parent_user_id;
}

interface MessageWithThreadRow extends MessageRow {
  parent_user_id: number;
  child_user_id: number;
}

async function getMessageForParticipant(
  messageId: number,
  userId: number
): Promise<MessageWithThreadRow | null> {
  const result = await pool.query<MessageWithThreadRow>(
    `SELECT m.*, t.parent_user_id, t.child_user_id
     FROM family_messages m
     JOIN family_threads t ON t.id = m.thread_id
     WHERE m.id = $1 AND (t.parent_user_id = $2 OR t.child_user_id = $2)`,
    [messageId, userId]
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------
// GET /api/family/threads — caller's threads, with unread/held counts
// ---------------------------------------------------------------------
threadsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    await promoteHeldMessages({ recipientUserId: user.id });

    const result = await pool.query(
      `SELECT t.id AS thread_id,
              CASE WHEN t.parent_user_id = $1 THEN t.child_user_id ELSE t.parent_user_id END AS other_id,
              ou.display_name AS other_display_name,
              ou.age_band AS other_age_band,
              (SELECT COUNT(*)::int FROM family_messages m
                WHERE m.thread_id = t.id AND m.status = 'delivered' AND m.sender_id <> $1) AS unopened_count,
              (SELECT COUNT(*)::int FROM family_messages m
                WHERE m.thread_id = t.id AND m.status = 'held' AND m.sender_id = $1) AS held_count
       FROM family_threads t
       JOIN family_users ou ON ou.id = CASE WHEN t.parent_user_id = $1 THEN t.child_user_id ELSE t.parent_user_id END
       WHERE t.parent_user_id = $1 OR t.child_user_id = $1
       ORDER BY t.id`,
      [user.id]
    );

    res.status(200).json(
      result.rows.map((row) => ({
        id: row.thread_id,
        otherParticipant: {
          id: row.other_id,
          displayName: row.other_display_name,
          ageBand: row.other_age_band,
        },
        unopenedCount: row.unopened_count,
        heldCount: row.held_count,
      }))
    );
  })
);

// ---------------------------------------------------------------------
// GET /api/family/threads/:id — promotes held first, then returns the
// thread shaped per-viewer (sealed stubs for unopened deliveries, no
// held/cancelled messages from the other party at all).
// ---------------------------------------------------------------------
threadsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    const threadId = parseId(req.params.id);
    if (threadId === null) {
      res.status(400).json({ error: 'Invalid thread id' });
      return;
    }

    const thread = await getThreadForParticipant(threadId, user.id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    await promoteHeldMessages({ threadId });

    const otherId = otherParticipantId(thread, user.id);
    const otherResult = await pool.query('SELECT id, display_name, age_band FROM family_users WHERE id = $1', [
      otherId,
    ]);
    const other = otherResult.rows[0];

    const messagesResult = await pool.query<MessageRow>(
      `SELECT id, thread_id, sender_id, body_original, body_final, reframe_source, status,
              deliver_after, delivered_at, opened_at, created_at
       FROM family_messages
       WHERE thread_id = $1
       ORDER BY created_at ASC, id ASC`,
      [threadId]
    );

    const messages = messagesResult.rows
      .map((m) => shapeMessageForViewer(m, user.id))
      .filter((m): m is Record<string, unknown> => m !== null);

    res.status(200).json({
      id: thread.id,
      otherParticipant: { id: other.id, displayName: other.display_name, ageBand: other.age_band },
      messages,
    });
  })
);

// ---------------------------------------------------------------------
// POST /api/family/threads/:id/messages — compose a message into a thread.
// ---------------------------------------------------------------------
threadsRouter.post(
  '/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    const threadId = parseId(req.params.id);
    if (threadId === null) {
      res.status(400).json({ error: 'Invalid thread id' });
      return;
    }

    const thread = await getThreadForParticipant(threadId, user.id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const { bodyFinal, bodyOriginal, reframeSource, holdMinutes } = req.body ?? {};

    if (!isNonEmptyString(bodyFinal)) {
      res.status(400).json({ error: 'bodyFinal is required' });
      return;
    }
    if (!(REFRAME_SOURCES as readonly string[]).includes(reframeSource)) {
      res.status(400).json({ error: `reframeSource must be one of ${REFRAME_SOURCES.join(', ')}` });
      return;
    }
    if (!(HOLD_MINUTES_OPTIONS as readonly number[]).includes(holdMinutes)) {
      res.status(400).json({ error: `holdMinutes must be one of ${HOLD_MINUTES_OPTIONS.join(', ')}` });
      return;
    }

    const trimmedBodyFinal = bodyFinal.trim();
    const finalBodyOriginal = isNonEmptyString(bodyOriginal) ? bodyOriginal.trim() : trimmedBodyFinal;
    const isImmediate = holdMinutes === 0;
    const status = isImmediate ? 'delivered' : 'held';
    const deliverAfter = new Date(Date.now() + holdMinutes * 60 * 1000);
    const deliveredAt = isImmediate ? new Date() : null;

    const result = await pool.query<MessageRow>(
      `INSERT INTO family_messages
         (thread_id, sender_id, body_original, body_final, reframe_source, status, deliver_after, delivered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, thread_id, sender_id, body_original, body_final, reframe_source, status,
                 deliver_after, delivered_at, opened_at, created_at`,
      [threadId, user.id, finalBodyOriginal, trimmedBodyFinal, reframeSource, status, deliverAfter, deliveredAt]
    );
    const message = result.rows[0];

    if (isImmediate) {
      const recipientId = otherParticipantId(thread, user.id);
      await notify(recipientId, {
        type: 'message_waiting',
        title: `${user.displayName} sent you a message`,
        linkPath: `/family/thread.html?id=${threadId}`,
      });
    }

    res.status(201).json(senderShape(message));
  })
);

// ---------------------------------------------------------------------
// POST /api/family/messages/:id/open — recipient reveals a delivered,
// unopened message. Notifies the sender.
// ---------------------------------------------------------------------
messagesRouter.post(
  '/:id/open',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    const messageId = parseId(req.params.id);
    if (messageId === null) {
      res.status(400).json({ error: 'Invalid message id' });
      return;
    }

    const message = await getMessageForParticipant(messageId, user.id);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (message.sender_id === user.id) {
      res.status(400).json({ error: 'You cannot open your own message' });
      return;
    }
    if (message.status !== 'delivered') {
      res.status(409).json({ error: `Message cannot be opened while ${message.status}` });
      return;
    }

    const result = await pool.query<MessageRow>(
      `UPDATE family_messages SET status = 'opened', opened_at = now() WHERE id = $1
       RETURNING id, thread_id, sender_id, body_original, body_final, reframe_source, status,
                 deliver_after, delivered_at, opened_at, created_at`,
      [messageId]
    );
    const updated = result.rows[0];

    await notify(message.sender_id, {
      type: 'message_opened',
      title: `${user.displayName} opened your message`,
      linkPath: `/family/thread.html?id=${message.thread_id}`,
    });

    res.status(200).json(shapeMessageForViewer(updated, user.id));
  })
);

// ---------------------------------------------------------------------
// POST /api/family/messages/:id/cancel — sender only, only while held.
// ---------------------------------------------------------------------
messagesRouter.post(
  '/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    const messageId = parseId(req.params.id);
    if (messageId === null) {
      res.status(400).json({ error: 'Invalid message id' });
      return;
    }

    const message = await getMessageForParticipant(messageId, user.id);
    if (!message || message.sender_id !== user.id) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (message.status !== 'held') {
      res.status(409).json({ error: `Message cannot be cancelled while ${message.status}` });
      return;
    }

    const result = await pool.query<MessageRow>(
      `UPDATE family_messages SET status = 'cancelled' WHERE id = $1
       RETURNING id, thread_id, sender_id, body_original, body_final, reframe_source, status,
                 deliver_after, delivered_at, opened_at, created_at`,
      [messageId]
    );
    res.status(200).json(senderShape(result.rows[0]));
  })
);

// ---------------------------------------------------------------------
// PATCH /api/family/messages/:id — sender only, only while held.
// ---------------------------------------------------------------------
messagesRouter.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    const messageId = parseId(req.params.id);
    if (messageId === null) {
      res.status(400).json({ error: 'Invalid message id' });
      return;
    }

    const message = await getMessageForParticipant(messageId, user.id);
    if (!message || message.sender_id !== user.id) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (message.status !== 'held') {
      res.status(409).json({ error: `Message cannot be edited while ${message.status}` });
      return;
    }

    const { bodyFinal, bodyOriginal, reframeSource } = req.body ?? {};

    if (bodyFinal !== undefined && !isNonEmptyString(bodyFinal)) {
      res.status(400).json({ error: 'bodyFinal must be a non-empty string' });
      return;
    }
    if (reframeSource !== undefined && !(REFRAME_SOURCES as readonly string[]).includes(reframeSource)) {
      res.status(400).json({ error: `reframeSource must be one of ${REFRAME_SOURCES.join(', ')}` });
      return;
    }
    if (bodyFinal === undefined && bodyOriginal === undefined && reframeSource === undefined) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    const nextBodyFinal = isNonEmptyString(bodyFinal) ? bodyFinal.trim() : message.body_final;
    const nextBodyOriginal = isNonEmptyString(bodyOriginal) ? bodyOriginal.trim() : message.body_original;
    const nextReframeSource =
      reframeSource !== undefined ? reframeSource : message.reframe_source;

    const result = await pool.query<MessageRow>(
      `UPDATE family_messages
       SET body_final = $1, body_original = $2, reframe_source = $3
       WHERE id = $4
       RETURNING id, thread_id, sender_id, body_original, body_final, reframe_source, status,
                 deliver_after, delivered_at, opened_at, created_at`,
      [nextBodyFinal, nextBodyOriginal, nextReframeSource, messageId]
    );
    res.status(200).json(senderShape(result.rows[0]));
  })
);

export default threadsRouter;
export { messagesRouter };
