import { Router } from "express";
import projectController from "../controllers/project.Controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.post(  "/projects",              authMiddleware, projectController.createProject.bind(projectController));
router.get(   "/projects",              authMiddleware, projectController.getProjects.bind(projectController));
router.get(   "/projects/unassigned",   authMiddleware, projectController.getUnassignedVideos.bind(projectController));
// ⚠️ Static/exact routes MUST come before parameterized /:id routes
router.patch( "/projects/move",         authMiddleware, projectController.moveVideo.bind(projectController));
router.get(   "/projects/:id",          authMiddleware, projectController.getProjectDetails.bind(projectController));
router.put(   "/projects/:id",          authMiddleware, projectController.renameProject.bind(projectController));
router.delete("/projects/:id",          authMiddleware, projectController.deleteProject.bind(projectController));

export default router;
