// routes/scriptRoutes.ts
import express from 'express';
import scriptController from '../controllers/scriptController';

const router = express.Router();

// Generate new script
router.post('/generate', scriptController.generateScript);

// Regenerate specific scene
router.post('/regenerate-scene', scriptController.regenerateScene);

// Edit scene manually
router.post('/edit-scene', scriptController.editScene);

// Add new scene
router.post('/add-scene', scriptController.addScene);

// Delete scene
router.post('/delete-scene', scriptController.deleteScene);

// Validate script timing
router.post('/validate-timing', scriptController.validateTiming);

export default router;