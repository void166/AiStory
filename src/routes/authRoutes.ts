import { Router } from "express";
import { AuthController } from "../controllers/auth.Controller";

const router = Router();
const controller = new AuthController();

router.post('/signup', controller.signUp);
router.post('/login', controller.loginUp);

export default router;