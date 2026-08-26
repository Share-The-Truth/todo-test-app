import {
  api,
  $,
  el,
  clear,
  bootPage,
  copy,
  param,
  relTime,
  clockTime,
  countdownText,
  onSubmit,
  showError,
  clearError,
} from './app.js';

const threadId = param('id');
if (!threadId) {
  location.replace('/family/home.html');
  await new Promise(() => {}); // stop here while the browser navigates
}

const me = await bootPage({ back: '/family/home.html' });

const listHost = $('#messages');
const composeText = $('#compose');
const composeBlock = $('#compose-block');
const previewBlock = $('#preview-block');
const reframeNote = $('#reframe-note');
const rawText = $('#raw-text');
const reframedText = $('#reframed');
const colMine = $('#col-mine');
const colKinder = $('#col-kinder');
const errorNode = $('#compose-error');

let other = { displayName: 'them' };
let editingId = null; // pauses polling while an inline edit is open
const revealIds = new Set(); // messages just opened — get the reveal animation
const openOriginals = new Set(); // "what I first wrote" disclosures left open

// ---------------------------------------------------------------------
// Band-aware copy on the composer
// ---------------------------------------------------------------------
composeText.placeholder = copy('composePlaceholder');
$('#help-me').textContent = copy('helpButton');
$('#use-this').textContent = copy('useThis');
$('#keep-mine').textContent = copy('keepMine');
$('#send').textContent = copy('sendButton');
$('#hold-label').textContent = copy('holdLabel');
$('#hold-hint').textContent = copy('holdHint');
$('#col-mine-title').textContent = copy('yourWords');
$('#col-kinder-title').textContent = copy('kinderWords');

// ---------------------------------------------------------------------
// Hold selector
// ---------------------------------------------------------------------
const HOLD_OPTIONS = [
  { minutes: 0, label: copy('sendNow') },
  { minutes: 5, label: 'Hold 5 min' },
  { minutes: 15, label: 'Hold 15 min' },
  { minutes: 60, label: 'Hold 1 hour' },
];

const holdHost = $('#hold-options');
HOLD_OPTIONS.forEach((option, index) => {
  holdHost.append(
    el('label', { class: 'pill' }, [
      el('input', {
        type: 'radio',
        name: 'holdMinutes',
        value: String(option.minutes),
        'data-testid': `hold-${option.minutes}`,
        checked: index === 0,
      }),
      el('span', {}, option.label),
    ])
  );
});

function selectedHoldMinutes() {
  const checked = holdHost.querySelector('input[name="holdMinutes"]:checked');
  return checked ? Number(checked.value) : 0;
}

function resetHold() {
  const first = holdHost.querySelector('input[value="0"]');
  if (first) first.checked = true;
}

// ---------------------------------------------------------------------
// Reframe preview state
// ---------------------------------------------------------------------
let reframeSource = 'none';
let chosen = 'mine'; // 'mine' | 'kinder'

function enterComposeState() {
  chosen = 'mine';
  previewBlock.hidden = true;
  composeBlock.hidden = false;
}

// Textareas grow with their content — a suggestion should never be clipped.
function autoGrow(area) {
  area.style.height = 'auto';
  area.style.height = `${Math.min(area.scrollHeight + 4, 460)}px`;
}
reframedText.addEventListener('input', () => autoGrow(reframedText));

function enterPreviewState(raw, suggestion, source) {
  reframeSource = source === 'ai' || source === 'template' ? source : 'template';
  chosen = 'kinder';
  rawText.textContent = raw;
  reframedText.value = suggestion;
  colKinder.classList.add('chosen');
  colMine.classList.remove('chosen');
  composeBlock.hidden = true;
  previewBlock.hidden = false;
  autoGrow(reframedText); // only meaningful once the block is visible
}

$('#help-me').addEventListener('click', async () => {
  const raw = composeText.value.trim();
  clearError(errorNode);
  reframeNote.hidden = true;
  if (!raw) {
    showError(errorNode, 'Write what you want to say first — even the messy version.');
    composeText.focus();
    return;
  }
  const button = $('#help-me');
  button.disabled = true;
  button.textContent = copy('helpWorking');
  try {
    const result = await api('/reframe', {
      method: 'POST',
      body: { text: raw, threadId: Number(threadId) },
    });
    if (!result || typeof result.reframed !== 'string' || !result.reframed.trim()) {
      throw new Error('empty suggestion');
    }
    enterPreviewState(raw, result.reframed.trim(), result.source);
  } catch {
    // The reframe service is optional — never block someone from speaking.
    reframeNote.textContent = copy('reframeFailed');
    reframeNote.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = copy('helpButton');
  }
});

$('#use-this').addEventListener('click', () => {
  chosen = 'kinder';
  colKinder.classList.add('chosen');
  colMine.classList.remove('chosen');
  reframedText.focus();
});

$('#keep-mine').addEventListener('click', () => {
  chosen = 'mine';
  colMine.classList.add('chosen');
  colKinder.classList.remove('chosen');
  enterComposeState();
  composeText.focus();
});

// ---------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------
onSubmit(
  $('#composer-form'),
  async () => {
    const usingKinder = !previewBlock.hidden && chosen === 'kinder';
    const raw = composeText.value.trim();
    const bodyFinal = (usingKinder ? reframedText.value : composeText.value).trim();

    if (!bodyFinal) throw new Error('Nothing to send yet.');

    const body = {
      bodyFinal,
      reframeSource: usingKinder ? reframeSource : 'none',
      holdMinutes: selectedHoldMinutes(),
    };
    if (usingKinder && raw && raw !== bodyFinal) body.bodyOriginal = raw;

    await api(`/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body });

    composeText.value = '';
    reframedText.value = '';
    reframedText.style.height = '';
    reframeNote.hidden = true;
    reframeSource = 'none';
    enterComposeState();
    resetHold();
    await refresh();
  },
  { errorNode, busyText: copy('sending') }
);

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function statusMeta(message) {
  if (message.status === 'held') {
    const until = clockTime(message.deliverAfter);
    return el('span', { class: 'held' }, [
      `⏳ resting until ${until} · `,
      el('span', { 'data-countdown': message.deliverAfter }, countdownText(message.deliverAfter)),
    ]);
  }
  if (message.status === 'delivered') {
    return el('span', {}, '✉️ delivered, not opened yet');
  }
  if (message.status === 'opened') {
    return el('span', {}, `opened ${clockTime(message.openedAt)}`);
  }
  if (message.status === 'cancelled') {
    return el('span', {}, '↩︎ you took this one back');
  }
  return el('span', {}, relTime(message.createdAt));
}

function renderMine(message) {
  const node = el('div', { class: 'msg mine', 'data-message-id': message.id, 'data-status': message.status });

  const bubble = el(
    'div',
    { class: 'bubble', 'data-testid': 'my-message' },
    message.bodyFinal
  );
  if (message.status === 'cancelled') bubble.style.opacity = '0.55';
  node.append(bubble);

  const meta = el('div', { class: 'msg-meta' }, [
    el('span', { class: 'faint' }, relTime(message.createdAt)),
    statusMeta(message),
  ]);
  node.append(meta);

  if (message.bodyOriginal && message.bodyOriginal !== message.bodyFinal) {
    const details = el('details', { class: 'original', 'data-testid': 'original-text' }, [
      el('summary', {}, 'what I first wrote'),
      el('p', {}, message.bodyOriginal),
    ]);
    // Survive the 10s poll: an open disclosure stays open across re-renders.
    if (openOriginals.has(message.id)) details.open = true;
    details.addEventListener('toggle', () => {
      if (details.open) openOriginals.add(message.id);
      else openOriginals.delete(message.id);
    });
    node.append(details);
  }

  if (message.status === 'held') {
    const editBtn = el(
      'button',
      { class: 'btn btn-quiet btn-sm', type: 'button', 'data-testid': 'edit-held' },
      copy('editButton')
    );
    const cancelBtn = el(
      'button',
      { class: 'btn btn-quiet btn-sm', type: 'button', 'data-testid': 'cancel-held' },
      copy('cancelButton')
    );

    editBtn.addEventListener('click', () => startEdit(node, message));
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      try {
        await api(`/messages/${message.id}/cancel`, { method: 'POST' });
        await refresh();
      } catch (err) {
        cancelBtn.disabled = false;
        showError(errorNode, err.message || 'Could not take that back.');
      }
    });

    node.append(el('div', { class: 'msg-actions' }, [editBtn, cancelBtn]));
  }

  return node;
}

function startEdit(node, message) {
  editingId = message.id;
  clear(node);
  const area = el('textarea', { 'data-testid': 'edit-text', rows: '4' });
  area.value = message.bodyFinal;

  const save = el('button', { class: 'btn btn-sm', type: 'button', 'data-testid': 'save-edit' }, 'Save');
  const cancel = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Never mind');

  save.addEventListener('click', async () => {
    const next = area.value.trim();
    if (!next) return;
    save.disabled = true;
    try {
      await api(`/messages/${message.id}`, { method: 'PATCH', body: { bodyFinal: next } });
      editingId = null;
      await refresh();
    } catch (err) {
      save.disabled = false;
      showError(errorNode, err.message || 'Could not save that change.');
    }
  });
  cancel.addEventListener('click', async () => {
    editingId = null;
    await refresh();
  });

  node.append(
    el('div', { class: 'card', style: 'width:100%' }, [
      el('span', { class: 'label' }, 'Change it while it rests'),
      area,
      el('div', { class: 'btn-row', style: 'margin-top:10px' }, [save, cancel]),
    ])
  );
  area.focus();
}

function renderTheirs(message) {
  const node = el('div', { class: 'msg theirs', 'data-message-id': message.id });

  if (message.sealed) {
    const button = el('button', { class: 'envelope', type: 'button', 'data-testid': 'sealed-envelope' }, [
      el('div', { class: 'env-icon' }, '✉️'),
      el('div', { class: 'env-title' }, copy('sealedTitle', other.displayName)),
      el('div', { class: 'env-sub' }, copy('sealedSub')),
    ]);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api(`/messages/${message.id}/open`, { method: 'POST' });
        revealIds.add(message.id);
        await refresh();
      } catch (err) {
        button.disabled = false;
        showError(errorNode, err.message || 'Could not open that just now.');
      }
    });
    node.append(button);
    node.append(el('div', { class: 'msg-meta' }, el('span', {}, `arrived ${relTime(message.deliveredAt)}`)));
    return node;
  }

  const bubble = el('div', { class: 'bubble', 'data-testid': 'their-message' }, message.bodyFinal);
  if (revealIds.has(message.id)) bubble.classList.add('revealed');
  node.append(bubble);
  node.append(
    el('div', { class: 'msg-meta' }, [
      el('span', { class: 'faint' }, `${other.displayName} · ${relTime(message.createdAt || message.deliveredAt)}`),
    ])
  );
  return node;
}

function render(thread) {
  other = thread.otherParticipant || other;
  $('#thread-title').textContent = `You and ${other.displayName}`;

  clear(listHost);
  if (!thread.messages.length) {
    listHost.append(el('div', { class: 'empty' }, copy('threadIntro')));
    return;
  }
  for (const message of thread.messages) {
    listHost.append(message.senderId === me.id ? renderMine(message) : renderTheirs(message));
  }
}

async function refresh() {
  if (editingId !== null) return;
  try {
    const thread = await api(`/threads/${encodeURIComponent(threadId)}`);
    render(thread);
  } catch (err) {
    if (err.status === 404) {
      clear(listHost);
      listHost.append(el('div', { class: 'empty' }, 'This conversation is not available.'));
      return;
    }
    // A failed poll leaves what is already on screen alone.
    if (!listHost.querySelector('.msg, .empty')) {
      clear(listHost);
      listHost.append(el('div', { class: 'empty' }, 'Could not load this conversation.'));
    }
  }
}

// live countdowns on held messages
setInterval(() => {
  for (const node of document.querySelectorAll('[data-countdown]')) {
    node.textContent = countdownText(node.getAttribute('data-countdown'));
  }
}, 1000);

await refresh();
setInterval(() => {
  if (document.visibilityState === 'visible') refresh();
}, 10000);
