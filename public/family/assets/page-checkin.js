import { api, $, $$, el, clear, bootPage, copy, getBand, MOODS, moodEmoji, relTime, onSubmit } from './app.js';

const me = await bootPage({ back: '/family/home.html' });

$('#checkin-title').textContent = copy('checkinTitle');
$('#checkin-sub').textContent =
  getBand() === 'under10' ? 'Pick the face that feels like today.' : 'Whatever you pick is fine — your family can see it.';
$('[data-testid="checkin-submit"]').textContent = copy('checkinSubmit');

// The youngest band gets the emoji row only — no writing required.
const noteField = $('#note-field');
if (getBand() === 'under10') {
  noteField.hidden = true;
} else {
  $('#note-label').textContent = copy('checkinNoteLabel');
  $('#note').placeholder = copy('checkinNotePlaceholder');
}

// ---------------------------------------------------------------------
// Mood picker
// ---------------------------------------------------------------------
let mood = null;
const moodRow = $('#mood-row');

for (const option of MOODS) {
  const button = el(
    'button',
    {
      class: 'mood',
      type: 'button',
      'data-mood': String(option.value),
      'data-testid': `mood-${option.value}`,
      'aria-pressed': 'false',
      'aria-label': `${option.label} (${option.value} out of 5)`,
    },
    [el('span', { class: 'emoji' }, option.emoji), el('span', { class: 'mood-label' }, option.label)]
  );
  button.addEventListener('click', () => {
    mood = option.value;
    for (const other of $$('.mood', moodRow)) {
      other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
    }
  });
  moodRow.append(button);
}

// ---------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------
onSubmit(
  $('#checkin-form'),
  async () => {
    if (mood === null) throw new Error('Pick a face first.');
    const body = { mood };
    if (!noteField.hidden) {
      const note = $('#note').value.trim();
      if (note) body.note = note;
    }
    await api('/checkins', { method: 'POST', body });
    location.href = '/family/home.html?checkin=1';
  },
  { errorNode: $('#checkin-error'), busyText: 'Sharing…' }
);

// ---------------------------------------------------------------------
// Family feed
// ---------------------------------------------------------------------
const feed = $('#feed');
try {
  const checkins = await api('/checkins?days=7');
  clear(feed);
  if (!checkins.length) {
    feed.append(el('div', { class: 'empty' }, 'Nobody has checked in yet this week.'));
  } else {
    const card = el('div', { class: 'card' });
    for (const c of checkins) {
      card.append(
        el('div', { class: 'feed-item' }, [
          el('span', { class: 'feed-emoji' }, moodEmoji(c.mood)),
          el('div', { class: 'grow' }, [
            el('div', { class: 'row-between' }, [
              el('strong', {}, c.userId === me.id ? 'You' : c.displayName),
              el('span', { class: 'faint' }, relTime(c.createdAt)),
            ]),
            c.note ? el('p', { class: 'feed-note' }, c.note) : null,
          ]),
        ])
      );
    }
    feed.append(card);
  }
} catch {
  clear(feed);
  feed.append(el('div', { class: 'empty' }, 'Could not load the family feed.'));
}
