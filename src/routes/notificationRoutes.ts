import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as ctrl from "../controllers/notification.controller";

const router = Router();

router.get   ("/",               authMiddleware, ctrl.list);
router.get   ("/unread-count",   authMiddleware, ctrl.unreadCount);
router.patch ("/read-all",       authMiddleware, ctrl.markAllRead);
router.patch ("/:id/read",       authMiddleware, ctrl.markRead);
router.delete("/",               authMiddleware, ctrl.clearAll);
router.delete("/:id",            authMiddleware, ctrl.remove);

export default router;
