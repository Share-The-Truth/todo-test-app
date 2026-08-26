import { Router } from 'express';
import pool from '../../db.js';
import { requireAuth, AGE_BANDS } from '../middleware.js';
import { asyncHandler } from '../asyncHandler.js';
import { templateReframe } from './template.js';
import { reframeWithAnthropic } from './anthropic.js';

export type AgeBand = (typeof AGE_BANDS)[number];

export interface ReframeInput {
  text: string;
  senderRole: 'parent' | 'child';
  recipientAgeBand: AgeBand | null;
  senderName: string;
  recipientName: string;
}

export interface ReframeResult {
  reframed: string;
  source: 'ai' | 'template';
}

// Long enough for anything anyone actually wants to say to their child in
// one message; short enough that a paste-bomb can't run up an API bill.
const MAX_TEXT_LENGTH = 2000;

/**
 * Suggests a kinder version of `input.text`.
 *
 * With ANTHROPIC_API_KEY set, the AI path is tried first and any failure —
 * including empty or whitespace-only output — falls through to the
 * deterministic template. Without a key, the template is used directly.
 * This never throws and never returns an empty string: the compose screen
 * always has something to show.
 */
export async function reframeMessage(input: ReframeInput): Promise<ReframeResult> {
  if (process.env.ANTHROPIC_API_KEY) {
    const aiText = await reframeWithAnthropic(input).catch((err) => {
      console.warn('reframe: AI path failed unexpectedly — falling back to the template.', err);
      return null;
    });
    if (aiText && aiText.trim().length > 0) {
      return { reframed: aiText.trim(), source: 'ai' };
    }
  }

  try {
    return { reframed: templateReframe(input), source: 'template' };
  } catch (err) {
    // The template is pure and has no business throwing, but this endpoint
    // must not be the thing that breaks a hard conversation.
    console.warn('reframe: template fallback failed — returning a neutral suggestion.', err);
    return { reframed: 'There is something on my mind and I would like us to talk about it.', source: 'template' };
  }
}

// ---------------------------------------------------------------------
// Route: POST /api/family/reframe
//
// A pure transform. It reads the thread to work out who is being written
// to (and how old they are) and writes nothing at all — only the messages
// endpoint persists, and only whatever the sender approved.
// ---------------------------------------------------------------------

const reframeRouter = Router();

function parseId(raw: unknown): number | null {
  const str = String(raw);
  if (!/^\d+$/.test(str)) return null;
  const id = parseInt(str, 10);
  return Number.isInteger(id) ? id : null;
}

function toAgeBand(raw: unknown): AgeBand | null {
  return typeof raw === 'string' && (AGE_BANDS as readonly string[]).includes(raw) ? (raw as AgeBand) : null;
}

interface OtherParticipantRow {
  id: number;
  display_name: string;
  age_band: string | null;
}

// Membership check and recipient lookup in one query: a thread the caller
// is not part of comes back as null, which the route turns into a 404 (not
// a 403 — cross-family probing shouldn't confirm that a thread exists).
async function getOtherParticipant(threadId: number, userId: number): Promise<OtherParticipantRow | null> {
  const result = await pool.query<OtherParticipantRow>(
    `SELECT ou.id, ou.display_name, ou.age_band
     FROM family_threads t
     JOIN family_users ou
       ON ou.id = CASE WHEN t.parent_user_id = $2 THEN t.child_user_id ELSE t.parent_user_id END
     WHERE t.id = $1 AND (t.parent_user_id = $2 OR t.child_user_id = $2)`,
    [threadId, userId]
  );
  return result.rows[0] ?? null;
}

reframeRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = res.locals.user!;
    const { text, threadId } = req.body ?? {};

    if (typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      res.status(400).json({ error: `text must be ${MAX_TEXT_LENGTH} characters or fewer` });
      return;
    }

    const id = parseId(threadId);
    if (id === null) {
      res.status(400).json({ error: 'Invalid thread id' });
      return;
    }

    const recipient = await getOtherParticipant(id, user.id);
    if (!recipient) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const result = await reframeMessage({
      text: text.trim(),
      senderRole: user.role,
      recipientAgeBand: toAgeBand(recipient.age_band),
      senderName: user.displayName,
      recipientName: recipient.display_name,
    });

    res.status(200).json(result);
  })
);

export default reframeRouter;
