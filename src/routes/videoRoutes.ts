import { Router } from 'express';
import videoController from '../controllers/video.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

/**
 * @route   POST /api/video/generate
 * @desc    Generate a complete video from topic
 * @body    { topic, duration?, genre?, language?, imageStyle?, voiceId? }
 */
router.post('/generate',authMiddleware ,videoController.generateVideos);

/**
 * @route   GET /api/video
 * @desc    Get all videos for the authenticated user (paginated)
 * @query   page=1&limit=20
 */
router.get('/', authMiddleware, videoController.getUserVideos);

/**
 * @route   GET /api/video/:videoId
 * @desc    Get video generation status + scenes
 */
router.get('/:videoId',authMiddleware ,videoController.getVideoStatus);

/**
 * @route   DELETE /api/video/:videoId
 * @desc    Delete a video and its scenes
 */
router.delete('/:videoId', authMiddleware, videoController.deleteVideo);

/**
 * @route   POST /api/video/:videoId/regenerate/:sceneIndex
 * @desc    Regenerate specific scene media
 * @body    { regenerateWhat: 'audio' | 'image' | 'both' }
 */
router.post('/:videoId/regenerate/:sceneIndex',authMiddleware, videoController.regenerateScene);

/**
 * @route   POST /api/video/:videoId/reassemble
 * @desc    Re-render video with new transitions / subtitle style (no re-gen of media)
 * @body    { scenes, title?, sceneTransitions?, subtitleStyle?, disableSubtitles?, bgmPath? }
 */
router.post('/:videoId/reassemble',authMiddleware, videoController.reAssembleVideo);

/**
 * @route   POST /api/video/:videoId/regen-text
 * @desc    AI rewrite narration or imagePrompt for one scene
 * @body    { what: 'narration' | 'imagePrompt' | 'both', scene, time, narration, imagePrompt }
 */
router.post('/:videoId/regen-text',authMiddleware, videoController.regenSceneText);

router.patch('/scene/:id/image', authMiddleware, videoController.reGenImage);
router.patch('/scene/:id/narration', authMiddleware, videoController.reGenNarration);

export default router;
