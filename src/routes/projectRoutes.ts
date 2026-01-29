import { Router } from "express";
import { ProjecController } from "../controllers/project.Controller";
import { authMiddleware } from "../middleware/auth.middleware";


const router = Router();
const controller = new ProjecController();

router.post('/projects',
    authMiddleware,
    controller.createProject);


export default router;