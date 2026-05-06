import { Router } from "express";
import adminController from "../controllers/admin.controller";
import { adminMiddleware } from "../middleware/admin.middleware";

const router = Router();

// Public
router.post("/login",    adminController.login.bind(adminController));
router.post("/register", adminController.register.bind(adminController));

// Protected
router.get("/stats",                adminMiddleware, adminController.getStats.bind(adminController));
router.get("/users",                adminMiddleware, adminController.getUsers.bind(adminController));
router.get("/videos",               adminMiddleware, adminController.getVideos.bind(adminController));
router.get("/videos/:videoId",      adminMiddleware, adminController.getVideoDetail.bind(adminController));
router.delete("/videos/:videoId",   adminMiddleware, adminController.deleteVideo.bind(adminController));

export default router;
