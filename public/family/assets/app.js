// Between — shared front-end helpers.
// Plain ES module, no build step, no dependencies.

const API_BASE = '/api/family';

// ---------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------

const STATUS_FALLBACK = {
  400: 'Something in that form needs a tweak.',
  401: 'Please log in again.',
  403: 'You do not have access to that.',
  404: 'We could not find that.',
  409: 'That is already taken.',
  410: 'That link is no longer available.',
};

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// api('/auth/me') / api('/checkins', { method: 'POST', body: { mood: 4 } })
export async function api(path, opts = {}) {
  const { method = 'GET', body, headers, ...rest } = opts;
  const init = {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json', ...(headers || {}) },
    ...rest,
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(API_BASE + path, init);
  } catch (err) {
    throw new ApiError('We could not reach Between. Check your connection and try again.', 0, null);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message =
      (data && (data.error || data.message)) ||
      STATUS_FALLBACK[res.status] ||
      'Something went wrong. Please try again.';
    throw new ApiError(message, res.status, data);
  }
  return data;
}

// ---------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------

// Resolves with the me-object, or redirects to the login page on 401 and
// never resolves (so callers can safely keep going on the happy path).
export async function requireSession() {
  try {
    return await api('/auth/me');
  } catch (err) {
    if (err.status === 401) {
      location.replace('/family/');
      return new Promise(() => {});
    }
    throw err;
  }
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    /* logging out is best-effort */
  }
  location.href = '/family/';
}

// ---------------------------------------------------------------------
// Age bands
// ---------------------------------------------------------------------

export const BANDS = ['under10', '10-12', '13plus'];
export const BAND_LABELS = {
  under10: 'Under 10',
  '10-12': '10–12',
  '13plus': '13 and up',
};

const BAND_CLASSES = { under10: 'band-under10', '10-12': 'band-10-12', '13plus': 'band-13plus' };

let currentBand = 'adult';

// Adds band-under10 | band-10-12 | band-13plus to <body>. A parent (no
// age band) gets no class and the grown-up copy.
export function applyAgeBand(band) {
  const body = document.body;
  Object.values(BAND_CLASSES).forEach((cls) => body.classList.remove(cls));
  const cls = BAND_CLASSES[band];
  if (cls) {
    body.classList.add(cls);
    currentBand = band;
  } else {
    currentBand = 'adult';
  }
  return currentBand;
}

export function getBand() {
  return currentBand;
}

// ---------------------------------------------------------------------
// Copy dictionary — same key, different voice per band.
// ---------------------------------------------------------------------

const COPY = {
  adult: {
    composePlaceholder: "Say what you really mean — we'll help you shape it.",
    helpButton: 'Help me say it',
    helpWorking: 'Thinking…',
    yourWords: 'What you wrote',
    kinderWords: 'A kinder way',
    useThis: 'Use this',
    keepMine: 'Keep mine as-is',
    sendButton: 'Send',
    sending: 'Sending…',
    holdLabel: 'When should it land?',
    holdHint: 'Holding gives it a breather — you can edit or take it back while it waits.',
    sendNow: 'Send now',
    editButton: 'Edit',
    cancelButton: 'Take it back',
    threadIntro: 'Nothing here yet. Whatever you need to say can start here.',
    sealedTitle: (name) => `A message from ${name} is waiting.`,
    sealedSub: "Open it when you're ready.",
    talkTo: (name) => `Talk to ${name}`,
    talkSub: 'Write something, or read what’s waiting',
    checkinCta: 'How do I feel today?',
    checkinSub: 'Let your family know how your day is going',
    checkinTitle: 'How are you feeling?',
    checkinNoteLabel: "Want to say more? (you don't have to)",
    checkinNotePlaceholder: 'Anything you want to add…',
    checkinSubmit: 'Share how I feel',
    reframeFailed:
      "We couldn't fetch a suggestion just now — you can still edit and send it in your own words.",
  },
  under10: {
    composePlaceholder: 'Write what you want to say.',
    helpButton: 'Make it kind',
    helpWorking: 'Thinking…',
    yourWords: 'What you wrote',
    kinderWords: 'A kinder way',
    useThis: 'Use this one',
    keepMine: 'Keep mine',
    sendButton: 'Send it',
    sending: 'Sending…',
    holdLabel: 'When should it go?',
    holdHint: 'Waiting a bit is okay. You can change it while it waits.',
    sendNow: 'Send now',
    editButton: 'Change it',
    cancelButton: 'Take it back',
    threadIntro: 'Nothing here yet. You can say hello!',
    sealedTitle: (name) => `${name} sent you something.`,
    sealedSub: "Open it when you're ready.",
    talkTo: (name) => `Talk to ${name}`,
    talkSub: 'Say something nice, or read your message',
    checkinCta: 'How do I feel today?',
    checkinSub: 'Pick the face that feels right',
    checkinTitle: 'How do you feel today?',
    checkinNoteLabel: '',
    checkinNotePlaceholder: '',
    checkinSubmit: 'That’s me!',
    reframeFailed: "We couldn't think of one right now — your own words are good too.",
  },
  '10-12': {
    composePlaceholder: 'Say what you really mean — we can help you shape it.',
    helpButton: 'Help me say it',
    helpWorking: 'Thinking…',
    yourWords: 'What you wrote',
    kinderWords: 'A kinder way',
    useThis: 'Use this',
    keepMine: 'Keep mine',
    sendButton: 'Send',
    sending: 'Sending…',
    holdLabel: 'When should it land?',
    holdHint: 'Holding gives it a breather — you can edit or take it back while it waits.',
    sendNow: 'Send now',
    threadIntro: 'Nothing here yet. Whatever you want to say can start here.',
    sealedTitle: (name) => `A message from ${name} is waiting.`,
    sealedSub: "Open it when you're ready.",
    talkTo: (name) => `Talk to ${name}`,
    talkSub: 'Write something, or read what’s waiting',
    checkinCta: 'How do I feel today?',
    checkinSub: 'Let your family know how today is going',
    checkinTitle: 'How are you feeling?',
    checkinNoteLabel: "Want to say more? (you don't have to)",
    checkinNotePlaceholder: 'Anything you want to add…',
    checkinSubmit: 'Share how I feel',
    reframeFailed: "We couldn't fetch a suggestion just now — your own words work too.",
  },
  '13plus': {
    composePlaceholder: "Say what you really mean — we'll help you shape it.",
    helpButton: 'Help me say it',
    helpWorking: 'Thinking…',
    yourWords: 'What you wrote',
    kinderWords: 'A kinder way',
    useThis: 'Use this',
    keepMine: 'Keep mine as-is',
    sendButton: 'Send',
    sending: 'Sending…',
    holdLabel: 'When should it land?',
    holdHint: 'Holding gives it a breather — you can edit or take it back while it waits.',
    sendNow: 'Send now',
    threadIntro: 'Nothing here yet. Whatever you need to say can start here.',
    sealedTitle: (name) => `A message from ${name} is waiting.`,
    sealedSub: 'Open it whenever you want.',
    talkTo: (name) => `Talk to ${name}`,
    talkSub: 'Write something, or read what’s waiting',
    checkinCta: 'How am I doing today?',
    checkinSub: 'Let your family know how today is going',
    checkinTitle: 'How are you feeling?',
    checkinNoteLabel: "Want to say more? (you don't have to)",
    checkinNotePlaceholder: 'Anything you want to add…',
    checkinSubmit: 'Share how I feel',
    reframeFailed:
      "We couldn't fetch a suggestion just now — you can still edit and send it in your own words.",
  },
};

// copy('helpButton') / copy('talkTo', 'Dad')
export function copy(key, ...args) {
  const table = COPY[currentBand] || COPY.adult;
  let value = table[key];
  if (value === undefined) value = COPY.adult[key];
  return typeof value === 'function' ? value(...args) : value;
}

// ---------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------

export function $(selector, root = document) {
  return root.querySelector(selector);
}
export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// Pages render user text as text nodes (el(..., 'text') / append), so raw
// user content never reaches innerHTML. Anywhere a string of markup does get
// built, every interpolated value must pass through here first.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  const letters = parts.slice(0, 2).map((p) => p[0] || '');
  return letters.join('').toUpperCase() || '?';
}

// ---------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------

export function showError(node, message) {
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
}
export function clearError(node) {
  if (!node) return;
  node.textContent = '';
  node.classList.remove('show');
}

// Wires submit → disabled button → handler → inline error on failure.
export function onSubmit(form, handler, { errorNode, button, busyText } = {}) {
  const errNode = errorNode || form.querySelector('.error');
  const btn = button || form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError(errNode);
    const originalText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      if (busyText) btn.textContent = busyText;
    }
    try {
      await handler(event);
    } catch (err) {
      showError(errNode, err && err.message ? err.message : 'Something went wrong.');
    } finally {
      if (btn) {
        btn.disabled = false;
        if (busyText) btn.textContent = originalText;
      }
    }
  });
}

// ---------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, '0');
}

export function clockTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "just now" → "5 min ago" → "14:32" (today) → "3 Aug, 14:32"
export function relTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 45 * 1000) return 'just now';
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (sameDay) return clockTime(date);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${clockTime(date)}`;
}

// "4 min 20 sec" style countdown to a future timestamp.
export function countdownText(value) {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return '';
  const remaining = Math.max(0, target - Date.now());
  if (remaining === 0) return 'landing now';
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m left`;
  }
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s left`;
  return `${seconds}s left`;
}

export const MOODS = [
  { value: 1, emoji: '😢', label: 'Rough' },
  { value: 2, emoji: '😕', label: 'Meh' },
  { value: 3, emoji: '😐', label: 'Okay' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '😄', label: 'Great' },
];

export function moodEmoji(mood) {
  const found = MOODS.find((m) => m.value === Number(mood));
  return found ? found.emoji : '🙂';
}

// ---------------------------------------------------------------------
// Header + bell
// ---------------------------------------------------------------------

// Renders the shared header into <header data-app-header>. `back` is an
// optional href for a back chevron.
export function renderHeader({ back = null, title = 'Between', showBell = true, showLogout = true } = {}) {
  const host = document.querySelector('[data-app-header]');
  if (!host) return;
  clear(host);

  const inner = el('div', { class: 'app-header-inner' });

  if (back) {
    inner.append(el('a', { class: 'header-back', href: back, 'aria-label': 'Back' }, '←'));
  }
  inner.append(
    el('a', { class: 'brand', href: '/family/home.html' }, [el('span', { class: 'dot' }), title])
  );
  if (showBell) {
    inner.append(
      el('a', { class: 'bell', href: '/family/notifications.html', 'aria-label': 'Notifications', 'data-bell': '' }, [
        '🔔',
        el('span', { class: 'bell-badge', 'data-bell-count': '', hidden: true }, '0'),
      ])
    );
  }
  if (showLogout) {
    const btn = el('button', { class: 'link-btn', type: 'button', 'data-logout': '' }, 'Log out');
    btn.addEventListener('click', () => logout());
    inner.append(btn);
  }
  host.append(inner);
}

let bellTimer = null;

// Keeps every [data-bell-count] badge in sync, ~every 15s.
export function startBellPolling(intervalMs = 15000) {
  const refresh = async () => {
    const badges = $$('[data-bell-count]');
    if (badges.length === 0) return;
    try {
      const unread = await api('/notifications?unread=1');
      const count = Array.isArray(unread) ? unread.length : 0;
      for (const badge of badges) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.hidden = count === 0;
      }
    } catch {
      /* a failed poll is not worth interrupting anyone for */
    }
  };
  refresh();
  if (bellTimer) clearInterval(bellTimer);
  bellTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, intervalMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  return refresh;
}

// Standard authed-page bootstrap: session guard + band class + header + bell.
export async function bootPage(options = {}) {
  const me = await requireSession();
  applyAgeBand(me.ageBand);
  renderHeader(options);
  startBellPolling();
  return me;
}

export function param(name) {
  return new URL(location.href).searchParams.get(name);
}
