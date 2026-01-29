// routes/aiImage.routes.ts
import express from 'express';
import aiImageController from '../controllers/imageController';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

// Generate images from script
router.post('/generate-from-script',
  authMiddleware,
  aiImageController.generateFromScript.bind(aiImageController)
);

// Generate custom image
router.post('/generate-custom',
  authMiddleware,
  aiImageController.generateCustom.bind(aiImageController)
);

// Regenerate single image
router.post('/regenerate',
  authMiddleware,
  aiImageController.regenerate.bind(aiImageController)
);

// Batch generation (parallel)
router.post('/generate-batch',
  authMiddleware,
  aiImageController.generateBatch.bind(aiImageController)
);

export default router;