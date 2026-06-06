import { Notification, type NotificationType } from "../model/Notification";

/**
 * Create a single in-app notification.
 *
 * This is a "fire-and-log" helper — it deliberately catches its own errors so
 * a notification failure can never break the calling flow (e.g. a successful
 * video generation should not 500 just because the notifications table is
 * temporarily unhappy).
 */
export async function createNotification(params: {
  userId:  string;
  type:    NotificationType;
  title:   string;
  message: string;
  link?:   string | null;
  data?:   Record<string, unknown> | null;
}): Promise<void> {
  try {
    await Notification.create({
      userId:  params.userId,
      type:    params.type,
      title:   params.title,
      message: params.message,
      link:    params.link ?? null,
      data:    params.data  ?? null,
    });
  } catch (err) {
    // Never throw from a notification path — log and swallow.
    console.error("[notificationService] createNotification failed:", err);
  }
}
