import { api, $, el, clear, bootPage, relTime, startBellPolling } from './app.js';

await bootPage({ back: '/family/home.html' });

const listHost = $('#notif-list');
const refreshBell = startBellPolling();

const ICONS = {
  invite_accepted: '🎉',
  message_waiting: '✉️',
  message_opened: '💛',
  checkin: '🌈',
};

async function load() {
  try {
    const notifications = await api('/notifications');
    clear(listHost);

    if (!notifications.length) {
      listHost.append(el('div', { class: 'empty' }, 'All quiet 💛'));
      return;
    }

    for (const n of notifications) {
      const unread = !n.readAt;
      const node = el(
        'a',
        {
          class: `notif${unread ? ' unread' : ''}`,
          href: n.linkPath || '/family/home.html',
          'data-testid': 'notification',
          'data-unread': unread ? 'true' : 'false',
        },
        [
          el('div', { class: 'row', style: 'align-items:flex-start' }, [
            el('span', { style: 'font-size:1.2em;line-height:1.3' }, ICONS[n.type] || '🔔'),
            el('div', { class: 'grow' }, [
              el('div', { class: 'notif-title' }, n.title),
              n.body ? el('div', { class: 'notif-body' }, n.body) : null,
              el('div', { class: 'faint', style: 'margin-top:4px' }, relTime(n.createdAt)),
            ]),
          ]),
        ]
      );

      // Mark read on the way out, then follow the link.
      node.addEventListener('click', async (event) => {
        if (!unread) return;
        event.preventDefault();
        try {
          await api(`/notifications/${n.id}/read`, { method: 'POST' });
        } catch {
          /* still let them through */
        }
        location.href = node.getAttribute('href');
      });

      listHost.append(node);
    }
  } catch {
    clear(listHost);
    listHost.append(el('div', { class: 'empty' }, 'Could not load your notifications.'));
  }
}

$('#read-all').addEventListener('click', async () => {
  const button = $('#read-all');
  button.disabled = true;
  try {
    await api('/notifications/read-all', { method: 'POST' });
    await load();
    await refreshBell();
  } finally {
    button.disabled = false;
  }
});

await load();
