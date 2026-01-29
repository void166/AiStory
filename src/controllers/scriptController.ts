// controllers/aiScriptController.ts
import { Request, Response } from 'express';
import scriptService from '../services/ai/scriptService';

export class AIScriptController {
  /**
   * Generate script only
   * POST /api/ai/script/generate
   */
  async generateScript(req: Request, res: Response) {
    try {
      // 1. Validate input
      const { message, duration, genre, language } = req.body;

      if (!message || message.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Message is required'
        });
      }

      // 2. Call service
      console.log(`Generating script for: ${message}`);
      
      const scriptData = await scriptService.generate(message, {
        duration: duration ? parseInt(duration) : undefined,
        genre,
        language
      });

      // 3. Success response
      return res.status(200).json({
        success: true,
        message: 'Script generated successfully',
        data: scriptData
      });

    } catch (error: any) {
      console.error('Script generation error:', error);

      // 4. Error response
      return res.status(500).json({
        success: false,
        message: 'Failed to generate script',
        error: error.message
      });
    }
  }

  /**
   * Regenerate specific scene
   * POST /api/ai/script/regenerate-scene
   */
  async regenerateScene(req: Request, res: Response) {
    try {
      const { script, sceneIndex, customPrompt } = req.body;

      if (!script || sceneIndex === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Script and sceneIndex are required'
        });
      }

      const newScene = await scriptService.regenerateScene(
        script,
        parseInt(sceneIndex),
        customPrompt
      );

      return res.status(200).json({
        success: true,
        message: 'Scene regenerated',
        data: newScene
      });

    } catch (error: any) {
      console.error('Scene regeneration error:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to regenerate scene',
        error: error.message
      });
    }
  }
}

export default new AIScriptController();