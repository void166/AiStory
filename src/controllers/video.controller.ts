// controllers/videoController.ts
import { Request, Response } from 'express';
import videoService from '../services/ai/videoService';
import type { TransitionPreset } from '../services/ai/effects';

// Helper to safely extract string param
function getStringParam(param: string | string[] | undefined): string | null {
  if (!param) return null;
  return Array.isArray(param) ? param[0] : param;
}

class VideoController {
  
  async generateVideos(req: Request, res: Response): Promise<void> {
    try {
      const {
        topic,
        duration,
        genre,
        language,
        imageStyle,
        voiceId,
        bgmPath,
        bgmVolume,
        globalTransition,  
        sceneEffects,      
        subtitleStyle,     
        disableSubtitles,  
      } = req.body;

      // Validation
      if (!topic || topic.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'Topic is required'
        });
        return;
      }

      console.log('\n📥 Video generation request received:');
      console.log('  Topic:', topic);
      console.log('  Duration:', duration || 60);
      console.log('  Genre:', genre || 'horror');
      console.log('  Language:', language || 'mongolian');
      console.log('  BGM:', bgmPath || 'history1');
      console.log('  Subtitles disabled:', disableSubtitles ?? false);


      const result = await videoService.generateVideos(topic, {
        duration:         duration         || 60,
        genre:            genre            || 'horror',
        language:         language         || 'mongolian',
        imageStyle:       imageStyle       || 'anime',
        voiceId:          voiceId          || 'JBFqnCBsd6RMkjVDRZzb',
        bgmPath:          bgmPath          || 'history1',
        bgmVolume:        bgmVolume        || '0.15',
        globalTransition: globalTransition || undefined,   // ← нэмсэн
        sceneEffects:     sceneEffects     || undefined,   // ← нэмсэн
        subtitleStyle:    subtitleStyle    || undefined,   // ← нэмсэн
        disableSubtitles: disableSubtitles ?? false,       // ← нэмсэн
      });

      console.log('\nVideo generation successful');

      res.status(200).json({
        success: true,
        data: result,
        message: 'Video generated successfully'
      });

    } catch (error: any) {
      console.error('\nVideo generation error:', error);

      res.status(500).json({
        success: false,
        error: error.message || 'Video generation failed',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  async regenerateScene(req: Request, res: Response): Promise<void> {
    try {
      const videoId = getStringParam(req.params.videoId);
      const { sceneIndex, regenerateWhat, imagePrompt, narration, time, scene } = req.body;

      if (!videoId) {
        res.status(400).json({ success: false, error: 'Video ID is required' });
        return;
      }

      if (sceneIndex === undefined || sceneIndex < 0) {
        res.status(400).json({ success: false, error: 'Valid scene index is required' });
        return;
      }

      if (!['audio', 'image', 'both'].includes(regenerateWhat)) {
        res.status(400).json({ success: false, error: 'regenerateWhat must be: audio, image, or both' });
        return;
      }

      console.log(`\nRegenerate request: ${videoId} / scene ${sceneIndex} / ${regenerateWhat}`);

      const result = await videoService.regenerateSceneMedia(
        videoId, sceneIndex, regenerateWhat,
        { imagePrompt, narration, time, scene },
      );

      res.status(200).json({
        success: true,
        data: result,
        message: `Scene ${regenerateWhat} regenerated successfully`
      });

    } catch (error: any) {
      console.error('\n❌ Scene regeneration error:', error);
      res.status(500).json({ success: false, error: error.message || 'Scene regeneration failed' });
    }
  }

  async getVideoStatus(req: Request, res: Response): Promise<void> {
    try {
      const videoId = getStringParam(req.params.videoId);

      if (!videoId) {
        res.status(404).json({ success: false, error: 'Video ID is required' });
        return;
      }

      const video = await videoService.getVideoStatus(videoId);

      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }

      res.status(200).json({ success: true, data: video });

    } catch (error: any) {
      console.error('\n❌ Get video status error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to get video status' });
    }
  }

  async reAssembleVideo(req: Request, res: Response): Promise<void> {
    try {
      const videoId = getStringParam(req.params.videoId);
      if (!videoId) {
        res.status(400).json({ success: false, error: 'Video ID is required' });
        return;
      }

      const {
        scenes,
        title,
        sceneTransitions,
        subtitleStyle,
        disableSubtitles,
        bgmPath,
        bgmVolume,
        genre,
      } = req.body;

      if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
        res.status(400).json({ success: false, error: 'scenes array is required' });
        return;
      }

      const VALID_TRANSITIONS: TransitionPreset[] = ['fadeblack','fade','wiperight','wipeleft','hard-cut'];

      const sceneEffects: Array<{ transition?: TransitionPreset }> = scenes.map((_: unknown, i: number) => {
        const t = sceneTransitions?.[i];
        return { transition: VALID_TRANSITIONS.includes(t) ? (t as TransitionPreset) : undefined };
      });

      console.log(`\n🔁 Re-assemble request: ${videoId} / ${scenes.length} scenes`);

      const result = await videoService.reAssembleVideo(videoId, scenes, title || 'Video', {
        sceneEffects,
        subtitleStyle:    subtitleStyle    || undefined,
        disableSubtitles: disableSubtitles ?? false,
        bgmPath:          bgmPath          || undefined,
        bgmVolume:        bgmVolume        || '0.15',
        genre:            genre            || undefined,
      });

      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.error('\n❌ Re-assemble error:', error);
      res.status(500).json({ success: false, error: error.message || 'Re-assemble failed' });
    }
  }

  async testGeneration(req: Request, res: Response): Promise<void> {
    try {
      console.log('\n🧪 Running test generation...');

      const testResult = await videoService.generateVideos(
        'Хар сүүдрийн нууц',
        {
          duration:         20,
          genre:            'horror',
          language:         'mongolian',
          imageStyle:       'anime',
          voiceId:          'JBFqnCBsd6RMkjVDRZzb',
          bgmPath:          'scary1',
          bgmVolume:        '0.15',
          disableSubtitles: false,
        }
      );

      res.status(200).json({
        success: true,
        data: testResult,
        message: 'Test generation completed'
      });

    } catch (error: any) {
      console.error('\n❌ Test generation error:', error);
      res.status(500).json({ success: false, error: error.message, details: error.stack });
    }
  }
}

export default new VideoController();