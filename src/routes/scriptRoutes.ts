// routes/aiScript.routes.ts
import express from 'express';
import aiScriptController from '../controllers/scriptController';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

// Generate script
router.post('/generate', 
  authMiddleware, 
  aiScriptController.generateScript.bind(aiScriptController)
);

// Regenerate specific scene
router.post('/regenerate-scene',
  authMiddleware,
  aiScriptController.regenerateScene.bind(aiScriptController)
);

export default router;