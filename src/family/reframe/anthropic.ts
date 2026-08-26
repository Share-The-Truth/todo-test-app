import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from './prompt.js';
import type { ReframeInput } from './index.js';

// The AI path. Everything in here is best-effort: any failure returns null
// and index.ts falls back to the deterministic template, so a family never
// sees an error where a suggestion should be.

// claude-haiku-4-5 is fast and cheap, which matters for a screen where the
// sender is sitting there waiting. Override with REFRAME_MODEL (for example
// claude-sonnet-5) when quality matters more than latency. These IDs are
// exact and current — never append a date suffix.
const DEFAULT_MODEL = 'claude-haiku-4-5';
const REQUEST_TIMEOUT_MS = 10_000;

let client: Anthropic | null = null;

// Constructed lazily and reused: the SDK reads the credential from the
// environment, so building one at import time would tie module load to
// ANTHROPIC_API_KEY being present.
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/**
 * Asks Claude to rewrite the sender's message. Returns the rewrite, or null
 * if anything at all went wrong (auth, rate limit, timeout, empty output).
 * Never throws.
 */
export async function reframeWithAnthropic(input: ReframeInput): Promise<string | null> {
  try {
    const response = await getClient().messages.create(
      {
        model: process.env.REFRAME_MODEL || DEFAULT_MODEL,
        max_tokens: 1024,
        system: buildSystemPrompt(input),
        // The raw message goes in as the user turn, never as part of the
        // system prompt — whatever it contains is content to rewrite, not
        // an instruction to follow.
        messages: [{ role: 'user', content: input.text }],
      },
      { timeout: REQUEST_TIMEOUT_MS }
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    return text.length > 0 ? text : null;
  } catch (err) {
    // Most specific first. One warning line, then the template takes over.
    if (err instanceof Anthropic.AuthenticationError) {
      console.warn('reframe: Anthropic rejected the credentials — falling back to the template.');
    } else if (err instanceof Anthropic.RateLimitError) {
      console.warn('reframe: Anthropic rate limit hit — falling back to the template.');
    } else if (err instanceof Anthropic.APIError) {
      console.warn(`reframe: Anthropic API error (${err.status ?? 'no status'}) — falling back to the template.`);
    } else {
      console.warn('reframe: unexpected failure calling Anthropic — falling back to the template.', err);
    }
    return null;
  }
}
