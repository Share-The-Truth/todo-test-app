import type { ReframeInput } from './index.js';

// Deterministic, dependency-free reframing.
//
// This is two things at once: the fallback used whenever the AI path is
// unavailable (no ANTHROPIC_API_KEY, network trouble, a bad response), and
// the thing CI actually asserts on — so it must be a pure function with no
// I/O, no clock, and no randomness. Same input, same output, always.
//
// It is deliberately modest. It cannot understand a message; it can only
// take the sharpest edges off one and put it into a first-person frame that
// the sender can then edit. The AI path is what makes a good rewrite; this
// is what makes sure something kind always comes back.

// ---------------------------------------------------------------------
// Shouting
// ---------------------------------------------------------------------

// Collapses ALL-CAPS words to lower case ("STUFF" -> "stuff") while leaving
// ordinary words and the pronoun "I" alone.
function collapseShouting(text: string): string {
  const lowered = text.replace(/[A-Za-z][A-Za-z']*/g, (word) => {
    const letters = word.replace(/[^A-Za-z]/g, '');
    if (letters.length < 2) return word; // "I", "a"
    if (letters !== letters.toUpperCase()) return word; // already has lower case
    return word.toLowerCase();
  });
  // Put the pronoun back ("i'm" -> "I'm").
  return lowered.replace(/\bi\b/g, 'I');
}

// Trims runs of terminal punctuation to a single mark ("!!!" -> "!",
// "?!?" -> "?") and normalises whitespace.
function calmPunctuation(text: string): string {
  return text
    .replace(/[!?]{2,}/g, (run) => (run.includes('?') ? '?' : '!'))
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------
// Softening a small insult / intensifier wordlist
// ---------------------------------------------------------------------

// Replacements are chosen to keep the sentence grammatical: an adjective is
// swapped for a milder adjective, so the surrounding words still fit.
const SOFTEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bshut up\b/gi, "let's pause"],
  [/\bshut it\b/gi, "let's pause"],
  [/\bstupidest\b/gi, 'most frustrating'],
  [/\bstupid\b/gi, 'frustrating'],
  [/\bidiotic\b/gi, 'frustrating'],
  [/\bidiots?\b/gi, 'frustrating'],
  [/\bmorons?\b/gi, 'frustrating'],
  [/\bdumb\b/gi, 'confusing'],
  [/\blazy\b/gi, 'unhelpful'],
  [/\buseless\b/gi, 'unhelpful'],
  [/\bpathetic\b/gi, 'upsetting'],
  [/\bridiculous\b/gi, 'confusing'],
  [/\bannoying\b/gi, 'frustrating'],
  [/\bselfish\b/gi, 'one-sided'],
  [/\bbrat\b/gi, 'upset'],
  [/\bdisgusting\b/gi, 'hard to be around'],
  [/\b(?:horrible|terrible|awful)\b/gi, 'hard'],
  [/\bworst\b/gi, 'hardest'],
  [/\bhates\b/gi, "really doesn't like"],
  [/\bhated\b/gi, "really didn't like"],
  [/\bhate\b/gi, "really don't like"],
  [/\bsucks\b/gi, 'is hard'],
  [/\bsuck\b/gi, 'are hard'],
  [/\bcrappy\b/gi, 'disappointing'],
  [/\b(?:goddamn|damn|bloody|freaking|frigging|fricking)\s+/gi, ''],
  // Absolutes that survived the opener rules below.
  [/\balways\b/gi, 'often'],
  [/\bnever\b/gi, 'hardly ever'],
];

function soften(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SOFTEN) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

// ---------------------------------------------------------------------
// Turning a verb into a gerund, so "you always take my stuff" can become
// "taking my stuff keeps happening" instead of naming a culprit.
// ---------------------------------------------------------------------

const IRREGULAR_GERUNDS: Readonly<Record<string, string>> = {
  am: 'being', is: 'being', are: 'being', was: 'being', were: 'being', be: 'being', been: 'being',
  do: 'doing', does: 'doing', did: 'doing', done: 'doing',
  have: 'having', has: 'having', had: 'having',
  go: 'going', goes: 'going', went: 'going',
  get: 'getting', gets: 'getting', got: 'getting',
  put: 'putting', puts: 'putting',
  let: 'letting', lets: 'letting',
  forget: 'forgetting', forgets: 'forgetting', forgot: 'forgetting',
  begin: 'beginning', admit: 'admitting',
  hit: 'hitting', cut: 'cutting', shut: 'shutting', sit: 'sitting', run: 'running', win: 'winning',
  tell: 'telling', tells: 'telling', told: 'telling',
  say: 'saying', says: 'saying', said: 'saying',
  take: 'taking', takes: 'taking', took: 'taking',
  make: 'making', makes: 'making', made: 'making',
  come: 'coming', comes: 'coming', came: 'coming',
  give: 'giving', gives: 'giving', gave: 'giving',
  leave: 'leaving', leaves: 'leaving', left: 'leaving',
  lie: 'lying', die: 'dying',
  listen: 'listening', listens: 'listening',
  ignore: 'ignoring', ignores: 'ignoring', ignored: 'ignoring',
};

function gerund(verb: string): string {
  const lower = verb.toLowerCase().replace(/[^a-z']/g, '');
  if (!lower) return verb;
  const known = IRREGULAR_GERUNDS[lower];
  if (known) return known;
  if (lower.endsWith('ing')) return lower;
  if (/ie$/.test(lower)) return `${lower.slice(0, -2)}ying`;
  if (/[^aeiou]e$/.test(lower)) return `${lower.slice(0, -1)}ing`;
  // Single-syllable consonant-vowel-consonant doubles: stop -> stopping.
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(lower)) return `${lower}${lower.slice(-1)}ing`;
  return `${lower}ing`;
}

// ---------------------------------------------------------------------
// Neutralising accusatory openers
// ---------------------------------------------------------------------

const BE_FORMS = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'being', 'been']);

function stripTerminal(text: string): string {
  return text.replace(/[.!?,;:\s]+$/, '').trim();
}

// "you always take my stuff" -> "taking my stuff keeps happening"
function alwaysClause(rest: string): string {
  const cleaned = stripTerminal(rest);
  if (!cleaned) return 'this keeps happening';
  const words = cleaned.split(' ');
  const head = gerund(words[0]);
  const tail = words.slice(1).join(' ');
  return `${head}${tail ? ` ${tail}` : ''} keeps happening`;
}

// "you never listen to me" -> "you don't listen to me"
function neverClause(rest: string): string {
  const cleaned = stripTerminal(rest);
  if (!cleaned) return "that doesn't happen";
  const words = cleaned.split(' ');
  if (BE_FORMS.has(words[0].toLowerCase())) {
    const tail = words.slice(1).join(' ');
    return `you aren't${tail ? ` ${tail}` : ''}`;
  }
  return `you don't ${cleaned}`;
}

// "you're so lazy" -> "it feels like you're being lazy" (the wordlist pass
// then softens the descriptor itself).
function descriptorClause(rest: string): string {
  const cleaned = stripTerminal(rest);
  if (!cleaned) return 'this is hard';
  return `it feels like you're being ${cleaned}`;
}

const LEAD_IN = String.raw`(?:and |but |so |ok |okay )*`;

interface Opener {
  clause: string;
  // True when an accusatory opener was actually rewritten — which is also
  // the signal that the clause needs a first-person frame around it.
  transformed: boolean;
}

// Rewrites a blaming opener into a neutral description of what happens.
// Anything it does not recognise comes back untouched.
function neutralizeOpener(sentence: string): Opener {
  const t = sentence.trim();
  let m: RegExpMatchArray | null;

  m = t.match(new RegExp(`^${LEAD_IN}why (?:do|did|must|would|can't|cant) you always\\b,?\\s*(.+)$`, 'i'));
  if (m) return { clause: alwaysClause(m[1]), transformed: true };

  m = t.match(new RegExp(`^${LEAD_IN}why (?:do|did|must|would|can't|cant) you never\\b,?\\s*(.+)$`, 'i'));
  if (m) return { clause: neverClause(m[1]), transformed: true };

  m = t.match(new RegExp(`^${LEAD_IN}why are you (?:so|such a|such an|always so)\\s+(.+)$`, 'i'));
  if (m) return { clause: descriptorClause(m[1]), transformed: true };

  m = t.match(new RegExp(`^${LEAD_IN}you(?:'re| are|r) (?:so|such a|such an|being so|always so)\\s+(.+)$`, 'i'));
  if (m) return { clause: descriptorClause(m[1]), transformed: true };

  m = t.match(new RegExp(`^${LEAD_IN}you(?:'re| are) never\\b\\s*(.+)$`, 'i'));
  if (m) return { clause: `you aren't ${stripTerminal(m[1])}`, transformed: true };

  m = t.match(new RegExp(`^${LEAD_IN}you(?:'re| are) always\\b\\s*(.+)$`, 'i'));
  if (m) return { clause: `you're often ${stripTerminal(m[1])}`, transformed: true };

  m = t.match(new RegExp(`^${LEAD_IN}you always\\b,?\\s*(.+)$`, 'i'));
  if (m) return { clause: alwaysClause(m[1]), transformed: true };

  m = t.match(new RegExp(`^${LEAD_IN}you never\\b,?\\s*(.+)$`, 'i'));
  if (m) return { clause: neverClause(m[1]), transformed: true };

  // A bare "you <verb> ..." opener. The behaviour itself is fine to name —
  // the blame lives in the framing — so the clause is kept as-is and the
  // scaffold below turns it into "I feel ... when you <verb> ...".
  return { clause: t, transformed: false };
}

// ---------------------------------------------------------------------
// Assembling the message
// ---------------------------------------------------------------------

// Words it is safe to de-capitalise when a clause moves into the middle of
// a sentence. Anything else (a name, most likely) keeps its capital.
const COMMON_STARTERS = new Set([
  'you', 'your', "you're", 'it', "it's", 'its', 'this', 'that', 'they', "they're", 'we', "we're",
  'he', 'she', 'there', 'when', 'my', 'the', 'a', 'an', 'everything', 'nothing', 'no', 'not',
  'i', 'all', 'being', 'having', 'getting', 'taking', 'making', 'saying', 'doing', 'let',
]);

function decapitalise(text: string): string {
  const firstWord = text.split(' ')[0]?.replace(/[^A-Za-z']/g, '').toLowerCase() ?? '';
  if (firstWord === 'i') return text;
  if (!COMMON_STARTERS.has(firstWord)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The "I feel ... when ..." frame belongs on messages aimed at the other
// person. A message that is already a first-person statement, or a plain
// boundary ("No, not past ten. That's the rule."), is left to stand on its
// own — wrapping it would distort what the sender meant.
function needsFeelingLead(clause: string, transformed: boolean): boolean {
  return transformed || /^(?:you|your)\b/i.test(clause.trim());
}

function splitFirstSentence(text: string): [string, string] {
  const m = text.match(/^(.*?[.!?])\s+(.*)$/s);
  if (!m) return [text, ''];
  return [m[1], m[2]];
}

interface Scaffold {
  lead: string;
  close: (vocative: string) => string;
}

// One scaffold per audience, each with wording distinct enough that the
// band a message was written for is visible in the result.
function scaffoldFor(input: ReframeInput): Scaffold {
  if (input.senderRole === 'child') {
    // Child -> parent: honest and respectful, without making the child
    // sound smaller or sorrier than they are.
    return {
      lead: 'I feel upset',
      close: (v) => `I'm not trying to be rude${v} — I'd really like you to hear me out.`,
    };
  }

  switch (input.recipientAgeBand) {
    case 'under10':
      return {
        lead: 'I feel sad',
        close: (v) => `I love you${v}. Can we make it better together?`,
      };
    case '10-12':
      return {
        lead: 'I feel upset',
        close: (v) => `Can we talk it through and find a fairer way${v}?`,
      };
    case '13plus':
      return {
        lead: 'I feel frustrated',
        close: (v) => `I'm not having a go at you${v} — can we work out something that suits us both?`,
      };
    default:
      return {
        lead: 'I feel upset',
        close: (v) => `Can we talk about it${v}?`,
      };
  }
}

function tidySentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const punctuated = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return capitalise(punctuated);
}

/**
 * Rewrites `input.text` into a calmer, first-person, age-appropriate message.
 * Pure and deterministic: no I/O, no clock, no randomness.
 */
export function templateReframe(input: ReframeInput): string {
  const source = typeof input.text === 'string' ? input.text : '';
  const calm = calmPunctuation(collapseShouting(source));

  const [firstSentence, remainder] = splitFirstSentence(calm);
  const { clause, transformed } = neutralizeOpener(firstSentence);
  const core = stripTerminal(soften(clause)) || 'something has been bothering me';
  const extra = tidySentence(soften(remainder));

  const { lead, close } = scaffoldFor(input);
  const recipient = typeof input.recipientName === 'string' ? input.recipientName.trim() : '';
  const vocative = recipient ? `, ${recipient}` : '';

  const opening = needsFeelingLead(core, transformed)
    ? `${lead} when ${decapitalise(core)}`
    : capitalise(core);

  return [`${opening}.`, extra, close(vocative)].filter(Boolean).join(' ');
}
