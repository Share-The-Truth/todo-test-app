import {
  api,
  $,
  el,
  clear,
  bootPage,
  copy,
  param,
  relTime,
  moodEmoji,
  initials,
  BAND_LABELS,
  onSubmit,
} from './app.js';

const content = $('#content');
const bannerSlot = $('#banner-slot');

const me = await bootPage();

// Small confirmation after a check-in ("→ home with a small confirmation").
if (param('checkin') === '1') {
  bannerSlot.append(
    el('div', { class: 'banner', 'data-testid': 'checkin-banner' }, 'Thanks for checking in 💛')
  );
  history.replaceState(null, '', '/family/home.html');
}

// ---------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------

function threadSubtitle(thread) {
  const bits = [];
  if (thread.unopenedCount > 0) {
    bits.push(`${thread.unopenedCount} waiting for you`);
  }
  if (thread.heldCount > 0) {
    bits.push(`${thread.heldCount} on hold`);
  }
  return bits.length ? bits.join(' · ') : 'All quiet';
}

function checkinStrip(checkins) {
  if (!checkins.length) {
    return el('div', { class: 'empty' }, 'No check-ins yet this week.');
  }
  const list = el('div', { class: 'card checkin-strip' });
  for (const c of checkins.slice(0, 5)) {
    list.append(
      el('div', { class: 'feed-item' }, [
        el('span', { class: 'feed-emoji' }, moodEmoji(c.mood)),
        el('div', { class: 'grow' }, [
          el('div', { class: 'row-between' }, [
            el('strong', {}, c.displayName),
            el('span', { class: 'faint' }, relTime(c.createdAt)),
          ]),
          c.note ? el('p', { class: 'feed-note' }, c.note) : null,
        ]),
      ])
    );
  }
  return list;
}

// ---------------------------------------------------------------------
// Parent home
// ---------------------------------------------------------------------

async function renderParent() {
  clear(content);

  content.append(
    el('h1', { class: 'page-title' }, `Hi ${me.displayName}`),
    el('p', { class: 'lede' }, me.familyName)
  );

  // --- conversations ---
  content.append(el('h2', { class: 'section-title' }, 'Your conversations'));
  const threadsHost = el('div', { class: 'stack-sm', 'data-testid': 'thread-list' });
  content.append(threadsHost);

  // --- check-ins ---
  content.append(
    el('div', { class: 'row-between', style: 'align-items:baseline' }, [
      el('h2', { class: 'section-title', style: 'margin-bottom:0' }, 'How everyone’s doing'),
      el('a', { href: '/family/checkin.html', class: 'faint', style: 'text-decoration:none' }, 'Add yours →'),
    ])
  );
  const checkinHost = el('div', { style: 'margin-top:10px' }, el('p', { class: 'loading' }, 'Loading…'));
  content.append(checkinHost);

  // --- invite a child ---
  content.append(el('h2', { class: 'section-title' }, 'Invite a child'));
  const inviteCard = el('div', { class: 'card' });
  inviteCard.innerHTML = `
    <form id="invite-form" data-testid="invite-form" novalidate>
      <div class="field">
        <label for="childDisplayName">Their name</label>
        <input id="childDisplayName" data-testid="invite-name" type="text" placeholder="Maya" required>
      </div>
      <div class="field">
        <span class="label">How old are they?</span>
        <div class="pills" role="radiogroup" aria-label="Age band"></div>
      </div>
      <div class="field">
        <label for="suggestedUsername">Suggested username <span class="muted">(optional)</span></label>
        <input id="suggestedUsername" data-testid="invite-username" type="text"
               autocapitalize="none" spellcheck="false" placeholder="maya">
        <p class="hint">They log in with a username — kids don't need an email address.</p>
      </div>
      <div class="form-actions">
        <button class="btn" type="submit" data-testid="invite-submit">Create an invite</button>
      </div>
      <div class="error" id="invite-error" role="alert"></div>
    </form>
    <div id="invite-result" hidden></div>
  `;
  content.append(inviteCard);

  const pills = inviteCard.querySelector('.pills');
  Object.entries(BAND_LABELS).forEach(([band, label], index) => {
    const id = `band-${band}`;
    pills.append(
      el('label', { class: 'pill' }, [
        el('input', {
          type: 'radio',
          name: 'ageBand',
          id,
          value: band,
          'data-testid': `invite-band-${band}`,
          checked: index === 1,
        }),
        el('span', {}, label),
      ])
    );
  });

  // --- pending invites ---
  content.append(el('h2', { class: 'section-title' }, 'Waiting to be used'));
  const invitesHost = el('div', { class: 'stack-sm', 'data-testid': 'pending-invites' });
  content.append(invitesHost);

  // --- children ---
  content.append(el('h2', { class: 'section-title' }, 'Your children'));
  const childrenHost = el('div', { class: 'stack-sm', 'data-testid': 'children-list' });
  content.append(childrenHost);

  // ------- data -------
  async function loadThreads() {
    const threads = await api('/threads');
    clear(threadsHost);
    clear(childrenHost);

    if (!threads.length) {
      threadsHost.append(
        el('div', { class: 'empty' }, 'No conversations yet — invite a child below and one opens up.')
      );
      childrenHost.append(el('div', { class: 'empty' }, 'Nobody has joined yet.'));
      return;
    }

    for (const thread of threads) {
      threadsHost.append(
        el(
          'a',
          {
            class: 'card card-link',
            href: `/family/thread.html?id=${thread.id}`,
            'data-testid': 'thread-card',
          },
          el('div', { class: 'row' }, [
            el('span', { class: 'avatar' }, initials(thread.otherParticipant.displayName)),
            el('div', { class: 'grow' }, [
              el('strong', {}, thread.otherParticipant.displayName),
              el('div', { class: 'faint' }, threadSubtitle(thread)),
            ]),
            el('span', { class: 'chev' }, '›'),
          ])
        )
      );

      const child = thread.otherParticipant;
      const resetBtn = el(
        'button',
        { class: 'btn btn-quiet btn-sm', type: 'button', 'data-testid': 'reset-password' },
        'Reset password'
      );
      resetBtn.addEventListener('click', async () => {
        const next = window.prompt(`New password for ${child.displayName} (at least 6 characters)`);
        if (next === null) return;
        if (next.length < 6) {
          window.alert('That password is too short — 6 characters or more.');
          return;
        }
        resetBtn.disabled = true;
        try {
          await api(`/children/${child.id}/reset-password`, {
            method: 'POST',
            body: { newPassword: next },
          });
          resetBtn.textContent = 'Password reset ✓';
        } catch (err) {
          window.alert(err.message || 'Could not reset that password.');
          resetBtn.textContent = 'Reset password';
        } finally {
          resetBtn.disabled = false;
        }
      });

      childrenHost.append(
        el('div', { class: 'card' }, [
          el('div', { class: 'row' }, [
            el('span', { class: 'avatar sage' }, initials(child.displayName)),
            el('div', { class: 'grow' }, [
              el('strong', {}, child.displayName),
              el('div', { class: 'faint' }, BAND_LABELS[child.ageBand] || 'Family member'),
            ]),
            resetBtn,
          ]),
        ])
      );
    }
  }

  async function loadInvites() {
    const invites = await api('/invites');
    const pending = invites.filter((i) => i.status === 'pending');
    clear(invitesHost);
    if (!pending.length) {
      invitesHost.append(el('div', { class: 'empty' }, 'No invites waiting.'));
      return;
    }
    for (const invite of pending) {
      const revokeBtn = el(
        'button',
        { class: 'btn btn-quiet btn-sm', type: 'button', 'data-testid': 'revoke-invite' },
        'Revoke'
      );
      revokeBtn.addEventListener('click', async () => {
        revokeBtn.disabled = true;
        try {
          await api(`/invites/${encodeURIComponent(invite.code)}/revoke`, { method: 'POST' });
          await loadInvites();
        } catch (err) {
          window.alert(err.message || 'Could not revoke that invite.');
          revokeBtn.disabled = false;
        }
      });

      invitesHost.append(
        el('div', { class: 'card' }, [
          el('div', { class: 'row' }, [
            el('div', { class: 'grow' }, [
              el('strong', {}, invite.childDisplayName),
              el('div', { class: 'faint' }, `${BAND_LABELS[invite.ageBand] || ''} · code ${invite.code}`),
            ]),
            revokeBtn,
          ]),
        ])
      );
    }
  }

  async function loadCheckins() {
    const checkins = await api('/checkins?days=7');
    clear(checkinHost);
    checkinHost.append(checkinStrip(checkins));
  }

  const resultHost = inviteCard.querySelector('#invite-result');
  onSubmit(
    inviteCard.querySelector('#invite-form'),
    async () => {
      const childDisplayName = inviteCard.querySelector('#childDisplayName').value.trim();
      const ageBand = (inviteCard.querySelector('input[name="ageBand"]:checked') || {}).value;
      const suggestedUsername = inviteCard.querySelector('#suggestedUsername').value.trim();
      if (!childDisplayName) throw new Error('What should we call them?');
      if (!ageBand) throw new Error('Pick an age band so we get the tone right.');

      const body = { childDisplayName, ageBand };
      if (suggestedUsername) body.suggestedUsername = suggestedUsername;
      const invite = await api('/invites', { method: 'POST', body });

      const joinUrl = location.origin + invite.joinUrl;
      clear(resultHost);
      resultHost.hidden = false;
      const copyBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Copy the link');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(joinUrl);
          copyBtn.textContent = 'Copied ✓';
        } catch {
          copyBtn.textContent = 'Copy failed — select it above';
        }
      });
      resultHost.append(
        el('hr', { class: 'divider' }),
        el('p', { class: 'muted', style: 'font-size:0.9em' }, [
          `Give ${childDisplayName} this code, or send them the link.`,
        ]),
        el('div', { class: 'code-box' }, [
          el('div', { class: 'code-value', 'data-testid': 'invite-code' }, invite.code),
          el('div', { class: 'code-link', 'data-testid': 'invite-link' }, joinUrl),
        ]),
        el('div', { class: 'btn-row', style: 'margin-top:12px' }, [copyBtn]),
        el('p', { class: 'hint' }, 'The code works once, and expires in 7 days.')
      );
      inviteCard.querySelector('#childDisplayName').value = '';
      inviteCard.querySelector('#suggestedUsername').value = '';
      await loadInvites();
    },
    { errorNode: inviteCard.querySelector('#invite-error'), busyText: 'Creating…' }
  );

  await Promise.all([
    loadThreads().catch(() => {
      clear(threadsHost);
      threadsHost.append(el('div', { class: 'empty' }, 'Could not load your conversations.'));
    }),
    loadInvites().catch(() => {
      clear(invitesHost);
      invitesHost.append(el('div', { class: 'empty' }, 'Could not load invites.'));
    }),
    loadCheckins().catch(() => {
      clear(checkinHost);
      checkinHost.append(el('div', { class: 'empty' }, 'Could not load check-ins.'));
    }),
  ]);
}

// ---------------------------------------------------------------------
// Child home
// ---------------------------------------------------------------------

async function renderChild() {
  clear(content);
  content.append(
    el('h1', { class: 'page-title' }, `Hi ${me.displayName}`),
    el('p', { class: 'lede' }, me.familyName)
  );

  const actions = el('div', { class: 'big-actions', style: 'margin-top:22px' }, [
    el('p', { class: 'loading' }, 'Loading…'),
  ]);
  content.append(actions);

  const checkinHost = el('div');
  content.append(
    el('h2', { class: 'section-title' }, 'How everyone’s doing'),
    checkinHost
  );

  try {
    const threads = await api('/threads');
    clear(actions);
    for (const thread of threads) {
      const name = thread.otherParticipant.displayName;
      const waiting = thread.unopenedCount;
      actions.append(
        el(
          'a',
          { class: 'big-btn', href: `/family/thread.html?id=${thread.id}`, 'data-testid': 'thread-card' },
          [
            el('span', { class: 'big-emoji' }, '💬'),
            el('span', { class: 'grow' }, [
              copy('talkTo', name),
              el(
                'span',
                { class: 'big-sub' },
                waiting > 0
                  ? `${waiting} message${waiting === 1 ? '' : 's'} waiting for you`
                  : copy('talkSub')
              ),
            ]),
          ]
        )
      );
    }
    actions.append(
      el('a', { class: 'big-btn', href: '/family/checkin.html', 'data-testid': 'checkin-cta' }, [
        el('span', { class: 'big-emoji' }, '🌈'),
        el('span', { class: 'grow' }, [
          copy('checkinCta'),
          el('span', { class: 'big-sub' }, copy('checkinSub')),
        ]),
      ])
    );
  } catch {
    clear(actions);
    actions.append(el('div', { class: 'empty' }, 'Could not load your conversations.'));
  }

  try {
    const checkins = await api('/checkins?days=7');
    clear(checkinHost);
    checkinHost.append(checkinStrip(checkins));
  } catch {
    clear(checkinHost);
    checkinHost.append(el('div', { class: 'empty' }, 'Could not load check-ins.'));
  }
}

if (me.role === 'parent') {
  await renderParent();
} else {
  await renderChild();
}
