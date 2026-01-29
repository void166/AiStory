// controllers/aiImageController.ts
import { Request, Response } from 'express';
import imageService from '../services/ai/imageService';

export class AIImageController {
  /**
   * Generate images from script
   * POST /api/ai/image/generate-from-script
   */
  async generateFromScript(req: Request, res: Response) {
    try {
      // 1. Validate input
      const { script, backgroundImages } = req.body;

      if (!script || !Array.isArray(script)) {
        return res.status(400).json({
          success: false,
          message: 'Script array is required'
        });
      }

      // 2. Call service
      console.log(`Generating images for ${script.length} scenes...`);

      const images = await imageService.generateFromScript(
        script,
        backgroundImages || []
      );

      // 3. Count successes
      const successCount = images.filter(img => img.imageUrl).length;
      const failCount = images.length - successCount;

      // 4. Success response
      return res.status(200).json({
        success: true,
        message: `Generated ${successCount}/${images.length} images`,
        data: {
          images,
          stats: {
            total: images.length,
            successful: successCount,
            failed: failCount
          }
        }
      });

    } catch (error: any) {
      console.error('Image generation error:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to generate images',
        error: error.message
      });
    }
  }

  /**
   * Generate single custom image
   * POST /api/ai/image/generate-custom
   */
  async generateCustom(req: Request, res: Response) {
    try {
      const { prompt, size, style, quality } = req.body;

      if (!prompt || prompt.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Prompt is required'
        });
      }

      console.log(`Generating custom image: ${prompt.substring(0, 50)}...`);

      const imageUrl = await imageService.generateCustom(prompt, {
        size,
        style,
        quality
      });

      return res.status(200).json({
        success: true,
        message: 'Image generated successfully',
        data: {
          imageUrl,
          prompt
        }
      });

    } catch (error: any) {
      console.error('Custom image generation error:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to generate custom image',
        error: error.message
      });
    }
  }

  /**
   * Regenerate single scene image
   * POST /api/ai/image/regenerate
   */
  async regenerate(req: Request, res: Response) {
    try {
      const { scene, customPrompt } = req.body;

      if (!scene) {
        return res.status(400).json({
          success: false,
          message: 'Scene is required'
        });
      }

      console.log(`Regenerating image for scene: ${scene.time}`);

      const imageUrl = await imageService.generateSingle(
        scene,
        customPrompt
      );

      return res.status(200).json({
        success: true,
        message: 'Image regenerated',
        data: {
          sceneTime: scene.time,
          imageUrl,
          prompt: customPrompt || scene.description
        }
      });

    } catch (error: any) {
      console.error('Image regeneration error:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to regenerate image',
        error: error.message
      });
    }
  }

  /**
   * Generate with batch processing (parallel)
   * POST /api/ai/image/generate-batch
   */
  async generateBatch(req: Request, res: Response) {
    try {
      const { script, backgroundImages, batchSize } = req.body;

      if (!script || !Array.isArray(script)) {
        return res.status(400).json({
          success: false,
          message: 'Script array is required'
        });
      }

      console.log(`Batch generating images (batch size: ${batchSize || 3})...`);

      const images = await imageService.generateBatch(
        script,
        backgroundImages || [],
        batchSize ? parseInt(batchSize) : undefined
      );

      const successCount = images.filter(img => img.imageUrl).length;

      return res.status(200).json({
        success: true,
        message: `Generated ${successCount}/${script.length} images`,
        data: {
          images,
          stats: {
            total: script.length,
            successful: successCount,
            failed: script.length - successCount
          }
        }
      });

    } catch (error: any) {
      console.error('Batch generation error:', error);

      return res.status(500).json({
        success: false,
        message: 'Batch generation failed',
        error: error.message
      });
    }
  }
}

export default new AIImageController();