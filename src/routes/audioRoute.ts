// routes/audio.routes.ts
import express from 'express';
import audioController from '../controllers/audioController';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

// Generate audio from text
router.post('/generate', 

  audioController.generateAudio.bind(audioController)
);

// Generate and download
router.post('/generate-download',

  audioController.generateAndDownload.bind(audioController)
);

// Generate from script
router.post('/generate-from-script',

  audioController.generateFromScript.bind(audioController)
);

router.post('/test-text-cleaning', audioController.testTextCleaning.bind(audioController));

export default router;