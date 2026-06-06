import type { Response } from "express";
import { Notification } from "../model/Notification";
import type { AuthRequest } from "../middleware/auth.middleware";

/**
 * GET /api/notifications?limit=20
 * Returns the user's notifications, newest first.
 */
export async function list(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const limit = Math.min(parseInt(String(req.query.limit ?? "30"), 10) || 30, 100);

    const rows = await Notification.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
      limit,
    });

    const unreadCount = await Notification.count({ where: { userId, isRead: false } });

    return res.json({
      success: true,
      data: {
        notifications: rows,
        unreadCount,
      },
    });
  } catch (err) {
    console.error("[notification.controller] list failed:", err);
    return res.status(500).json({ success: false, message: "Failed to load notifications" });
  }
}

/**
 * GET /api/notifications/unread-count
 * Lightweight endpoint for the bell-badge polling.
 */
export async function unreadCount(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const count = await Notification.count({ where: { userId, isRead: false } });
    return res.json({ success: true, data: { count } });
  } catch (err) {
    console.error("[notification.controller] unreadCount failed:", err);
    return res.status(500).json({ success: false, message: "Failed to load count" });
  }
}

/**
 * PATCH /api/notifications/:id/read
 */
export async function markRead(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const n = await Notification.findOne({ where: { id, userId } });
    if (!n) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    n.isRead = true;
    await n.save();
    return res.json({ success: true, data: n });
  } catch (err) {
    console.error("[notification.controller] markRead failed:", err);
    return res.status(500).json({ success: false, message: "Failed to update notification" });
  }
}

/**
 * PATCH /api/notifications/read-all
 */
export async function markAllRead(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    await Notification.update(
      { isRead: true },
      { where: { userId, isRead: false } },
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("[notification.controller] markAllRead failed:", err);
    return res.status(500).json({ success: false, message: "Failed to mark all read" });
  }
}

/**
 * DELETE /api/notifications/:id
 */
export async function remove(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const deleted = await Notification.destroy({ where: { id, userId } });
    if (deleted === 0) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("[notification.controller] remove failed:", err);
    return res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
}

/**
 * DELETE /api/notifications
 * Clears every notification for the user.
 */
export async function clearAll(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    await Notification.destroy({ where: { userId } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[notification.controller] clearAll failed:", err);
    return res.status(500).json({ success: false, message: "Failed to clear notifications" });
  }
}
