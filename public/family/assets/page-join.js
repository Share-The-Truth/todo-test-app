import { api, $, onSubmit, applyAgeBand, param, showError, clearError } from './app.js';

const panels = {
  loading: $('#loading-panel'),
  code: $('#code-panel'),
  invalid: $('#invalid-panel'),
  join: $('#join-panel'),
};

function show(name) {
  for (const [key, node] of Object.entries(panels)) node.hidden = key !== name;
}

let activeCode = null;

// Band-specific copy for the join page. The invite tells us the child's age
// band before they have an account, so the page can already speak their
// language (and drop the email field for the youngest).
const JOIN_COPY = {
  under10: {
    greeting: (name) => `Hi ${name}! 👋`,
    sub: (family) => `Your family made a quiet place for you to talk. You'll be part of ${family}.`,
    usernameLabel: 'Pick a name to log in with',
    usernameHint: 'Something easy for you to remember.',
    passwordLabel: 'Pick a secret word only you know',
    passwordHint: 'Six letters or more. Keep it to yourself.',
    submit: 'Let me in!',
    showEmail: false,
  },
  '10-12': {
    greeting: (name) => `Hi ${name}!`,
    sub: (family) => `You've been invited to join ${family} on Between — a calm place for the things that are hard to say.`,
    usernameLabel: 'Pick a username',
    usernameHint: 'This is how you log in. No email needed.',
    passwordLabel: 'Pick a password',
    passwordHint: 'At least 6 characters — something only you know.',
    submit: 'Join my family',
    showEmail: true,
  },
  '13plus': {
    greeting: (name) => `Hi ${name}.`,
    sub: (family) => `You've been invited to ${family} on Between — a quiet, one-to-one space for the conversations that are hard to start.`,
    usernameLabel: 'Pick a username',
    usernameHint: 'This is how you log in. An email is optional.',
    passwordLabel: 'Pick a password',
    passwordHint: 'At least 6 characters.',
    submit: 'Join my family',
    showEmail: true,
  },
};

function renderInvite(invite, code) {
  activeCode = code;
  const band = invite.ageBand && JOIN_COPY[invite.ageBand] ? invite.ageBand : '13plus';
  applyAgeBand(invite.ageBand);
  const c = JOIN_COPY[band];

  $('#greeting').textContent = c.greeting(invite.childDisplayName || 'there');
  $('#greeting-sub').textContent = c.sub(invite.familyName || 'your family');
  $('#username-label').textContent = c.usernameLabel;
  $('#username-hint').textContent = c.usernameHint;
  $('#password-label').textContent = c.passwordLabel;
  $('#password-hint').textContent = c.passwordHint;
  $('[data-testid="join-submit"]').textContent = c.submit;
  $('#email-field').hidden = !c.showEmail;
  if (invite.suggestedUsername) $('#username').value = invite.suggestedUsername;

  show('join');
}

async function lookup(code) {
  show('loading');
  try {
    const invite = await api('/invites/' + encodeURIComponent(code));
    renderInvite(invite, code);
  } catch (err) {
    if (err.status === 410 || err.status === 404) {
      show('invalid');
    } else {
      show('code');
      showError($('#code-error'), err.message || 'We could not check that code.');
    }
  }
}

// --- manual code entry -------------------------------------------------
onSubmit(
  $('#code-form'),
  async () => {
    const code = $('#code').value.trim();
    if (!code) throw new Error('Type the code your parent gave you.');
    clearError($('#code-error'));
    await lookup(code);
  },
  { errorNode: $('#code-error'), busyText: 'Checking…' }
);

$('#try-again').addEventListener('click', () => {
  $('#code').value = '';
  show('code');
});

// --- joining -----------------------------------------------------------
onSubmit(
  $('#join-form'),
  async () => {
    const username = $('#username').value.trim();
    const password = $('#password').value;
    const emailField = $('#email-field');
    const email = emailField.hidden ? '' : $('#email').value.trim();

    if (!username) throw new Error('Pick a name to log in with.');
    if (password.length < 6) throw new Error('Your secret word needs at least 6 characters.');

    const body = { code: activeCode, password, username };
    if (email) body.email = email;

    await api('/auth/join', { method: 'POST', body });
    location.href = '/family/home.html';
  },
  { errorNode: $('#join-error'), busyText: 'One moment…' }
);

// --- boot --------------------------------------------------------------
const codeFromUrl = (param('code') || '').trim();
if (codeFromUrl) {
  lookup(codeFromUrl);
} else {
  show('code');
}
