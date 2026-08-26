import pool from '../db.js';

export type NotificationType =
  | 'invite_accepted'
  | 'message_waiting'
  | 'message_opened'
  | 'checkin';

export interface NotifyEvent {
  type: NotificationType;
  title: string;
  body?: string | null;
  linkPath?: string | null;
}

// notify() is the entire delivery mechanism for this app: the app IS the
// platform, so "sending a notification" just means inserting a row into the
// in-app notification center. No email/SMS/push — see the plan amendments.
export async function notify(userId: number, event: NotifyEvent): Promise<void> {
  await pool.query(
    `INSERT INTO family_notifications (user_id, type, title, body, link_path)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, event.type, event.title, event.body ?? null, event.linkPath ?? null]
  );
}
