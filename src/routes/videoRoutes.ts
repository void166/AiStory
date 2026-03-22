// routes/video.routes.ts
import { Router } from 'express';
import videoController from '../controllers/video.controller';

const router = Router();

/**
 * @route   POST /api/video/generate
 * @desc    Generate a complete video from topic
 * @body    { topic, duration?, genre?, language?, imageStyle?, voiceId? }
 */
router.post('/generate', videoController.generateVideos);

/**
 * @route   GET /api/video/:videoId
 * @desc    Get video generation status
 */
router.get('/:videoId', videoController.getVideoStatus);

/**
 * @route   POST /api/video/:videoId/regenerate/:sceneIndex
 * @desc    Regenerate specific scene media
 * @body    { regenerateWhat: 'audio' | 'image' | 'both' }
 */
router.post('/:videoId/regenerate/:sceneIndex', videoController.regenerateScene);

/**
 * @route   POST /api/video/:videoId/reassemble
 * @desc    Re-render video with new transitions / subtitle style (no re-gen of media)
 * @body    { scenes, title?, sceneTransitions?, subtitleStyle?, disableSubtitles?, bgmPath? }
 */
router.post('/:videoId/reassemble', videoController.reAssembleVideo);

export default router;