import { api, $, onSubmit } from './app.js';

onSubmit(
  $('#register-form'),
  async () => {
    const displayName = $('#displayName').value.trim();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    const familyName = $('#familyName').value.trim();

    if (!displayName) throw new Error('Please add the name your family knows you by.');
    if (!email) throw new Error('Please add your email.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (!familyName) throw new Error('Give your family a name — anything you like.');

    await api('/auth/register', {
      method: 'POST',
      body: { email, password, displayName, familyName },
    });
    location.href = '/family/home.html';
  },
  { errorNode: $('#register-error'), busyText: 'Creating…' }
);
