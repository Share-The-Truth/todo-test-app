import { api, $, onSubmit } from './app.js';

const form = $('#login-form');

onSubmit(
  form,
  async () => {
    const identifier = $('#identifier').value.trim();
    const password = $('#password').value;
    if (!identifier || !password) {
      throw new Error('Please fill in both fields.');
    }
    await api('/auth/login', { method: 'POST', body: { identifier, password } });
    location.href = '/family/home.html';
  },
  { errorNode: $('#login-error'), busyText: 'Logging in…' }
);

// Already signed in? Skip straight to the family home. Runs after the form
// is wired so a fast typist is never racing the session check.
api('/auth/me')
  .then(() => location.replace('/family/home.html'))
  .catch(() => {
    /* not logged in — the form stays */
  });
