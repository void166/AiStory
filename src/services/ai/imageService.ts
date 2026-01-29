// services/ai/imageService.ts
import client from 'magic-hour';

interface ScriptScene {
  time: string;
  scene: string;
  description: string;
}

interface BackgroundImage {
  id: number;
  prompt: string;
  style?: {
    prompt?: string;
    type?: string;
    intensity?: number;
  };
}

interface GeneratedImage {
  sceneTime: string;
  imageUrl: string;
  prompt: string;
  backgroundImageId?: number;
  generatedAt: Date;
}

interface ImageGenerationOptions {
  size?: string;
  style?: {
    prompt?: string;
    type?: string;
    intensity?: number;
  };
  quality?: string;
}

class ImageService {
  private magicHour: any;

  constructor() {
    this.magicHour = new client({
      token: process.env.MAGICHOUR_API || ''
    });
  }

  /**
   * Generate images for all scenes
   */
  async generateFromScript(
    scenes: ScriptScene[],
    backgroundImages: BackgroundImage[]
  ): Promise<GeneratedImage[]> {
    console.log(`Starting generation for ${scenes.length} scenes...`);

    const results: GeneratedImage[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      try {
        console.log(`[${i + 1}/${scenes.length}] Generating image for scene: ${scene.time}`);

        // Find matching background prompt
        const bgImage = this.findMatchingBackground(scene, backgroundImages);

        // Generate image
        const imageUrl = await this.generateSingle(
          scene,
          bgImage?.prompt,
          bgImage?.style
        );

        results.push({
          sceneTime: scene.time,
          imageUrl,
          prompt: bgImage?.prompt || scene.description,
          backgroundImageId: bgImage?.id,
          generatedAt: new Date()
        });

        // Rate limiting
        if (i < scenes.length - 1) {
          console.log('Waiting 1s before next generation...');
          await this.delay(1000);
        }

      } catch (error: any) {
        console.error(`Failed to generate image for scene ${scene.time}:`, error.message);
        
        // Add placeholder
        results.push({
          sceneTime: scene.time,
          imageUrl: '', // Empty = failed
          prompt: scene.description,
          generatedAt: new Date()
        });
      }
    }

    console.log(`Generation complete: ${results.filter(r => r.imageUrl).length}/${scenes.length} successful`);

    return results;
  }

  /**
   * Generate single image
   */
  async generateSingle(
    scene: ScriptScene,
    customPrompt?: string,
    customStyle?: { prompt?: string; type?: string; intensity?: number }
  ): Promise<string> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const prompt = customPrompt || this.buildPrompt(scene);

        console.log(`Attempt ${attempt}/${maxRetries}: ${prompt.substring(0, 50)}...`);

        // ✅ FIX: Build complete style object with required prompt field
        const styleConfig = {
          prompt: customStyle?.prompt || prompt, // ✅ Required field
          type: customStyle?.type || 'cinematic',
          intensity: customStyle?.intensity || 0.8
        };

        const response = await this.magicHour.v1.aiImageGenerator.generate({
          prompt: prompt,
          imageCount: 1,
          size: '1024x1024',
          style: styleConfig,
          quality: 'standard'
        });

        if (!response?.data?.[0]?.url) {
          throw new Error('Invalid response from Magic Hour API');
        }

        return response.data[0].url;

      } catch (error: any) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message || error);

        // Handle rate limiting
        if (error.status === 429 && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`Rate limited. Waiting ${waitTime}ms...`);
          await this.delay(waitTime);
          continue;
        }

        // Handle content policy violation
        if (error.status === 400 && error.message?.includes('content policy')) {
          console.log('Content policy violation. Trying safer prompt...');
          
          const currentPrompt = customPrompt || this.buildPrompt(scene);
          const safePrompt = this.sanitizePrompt(currentPrompt);
          
          const response = await this.magicHour.v1.aiImageGenerator.generate({
            prompt: safePrompt,
            imageCount: 1,
            size: '1024x1024',
            style: {
              prompt: safePrompt,
              type: customStyle?.type || 'cinematic',
              intensity: customStyle?.intensity || 0.8
            },
            quality: 'standard'
          });

          if (!response?.data?.[0]?.url) {
            throw new Error('Invalid response from Magic Hour API');
          }

          return response.data[0].url;
        }

        // If last retry, throw
        if (attempt === maxRetries) {
          break;
        }

        // Wait before retry
        await this.delay(1000);
      }
    }

    throw new Error(`Image generation failed after ${maxRetries} attempts: ${lastError?.message || JSON.stringify(lastError)}`);
  }

  /**
   * Generate single image from custom prompt
   */
  async generateCustom(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<string> {
    try {
      const styleConfig = {
        prompt: options?.style?.prompt || prompt, // ✅ Required
        type: options?.style?.type || 'cinematic',
        intensity: options?.style?.intensity || 0.8
      };

      const response = await this.magicHour.v1.aiImageGenerator.generate({
        prompt: prompt,
        imageCount: 1,
        size: options?.size || '1024x1024',
        style: styleConfig,
        quality: options?.quality || 'standard'
      });

      if (!response?.data?.[0]?.url) {
        throw new Error('Invalid response from Magic Hour API');
      }

      return response.data[0].url;

    } catch (error: any) {
      console.error('Custom image generation failed:', error);
      throw new Error(`Failed to generate custom image: ${error.message}`);
    }
  }

  /**
   * Build detailed prompt from scene
   */
  private buildPrompt(scene: ScriptScene): string {
    return `${scene.scene}. ${scene.description}. Cinematic lighting, high quality, detailed, atmospheric, professional photography.`;
  }

  /**
   * Find matching background image
   */
  private findMatchingBackground(
    scene: ScriptScene,
    backgroundImages: BackgroundImage[]
  ): BackgroundImage | undefined {
    if (!backgroundImages || backgroundImages.length === 0) {
      return undefined;
    }

    // Parse time (e.g., "0-5" -> 0)
    const timeMatch = scene.time.match(/^(\d+)-/);
    if (!timeMatch) return backgroundImages[0];

    const startTime = parseInt(timeMatch[1]);

    // Each background covers ~5-20 seconds
    const imageIndex = Math.floor(startTime / 10);

    return backgroundImages[imageIndex] || backgroundImages[backgroundImages.length - 1];
  }

  /**
   * Sanitize prompt to avoid content policy violations
   */
  private sanitizePrompt(prompt: string): string {
    const sensitiveWords = [
      'blood', 'gore', 'violent', 'explicit', 'nude', 
      'sexual', 'weapon', 'death', 'kill', 'murder'
    ];

    let sanitized = prompt;

    sensitiveWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      sanitized = sanitized.replace(regex, '');
    });

    // Add safe terms
    sanitized += ' Safe for work, appropriate, artistic';

    return sanitized;
  }

  /**
   * Batch generation with parallel processing
   */
  async generateBatch(
    scenes: ScriptScene[],
    backgroundImages: BackgroundImage[],
    batchSize: number = 3
  ): Promise<GeneratedImage[]> {
    const results: GeneratedImage[] = [];

    for (let i = 0; i < scenes.length; i += batchSize) {
      const batch = scenes.slice(i, i + batchSize);

      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}...`);

      const promises = batch.map(async (scene): Promise<GeneratedImage | null> => {
        const bgImage = this.findMatchingBackground(scene, backgroundImages);

        try {
          const imageUrl = await this.generateSingle(
            scene, 
            bgImage?.prompt,
            bgImage?.style
          );

          return {
            sceneTime: scene.time,
            imageUrl,
            prompt: bgImage?.prompt || scene.description,
            backgroundImageId: bgImage?.id,
            generatedAt: new Date()
          };

        } catch (error: any) {
          console.error(`Batch generation failed for ${scene.time}:`, error.message);
          return null;
        }
      });

      const batchResults = await Promise.all(promises);
      
      const validResults = batchResults.filter((r): r is GeneratedImage => {
        return r !== null;
      });
      
      results.push(...validResults);

      // Wait between batches
      if (i + batchSize < scenes.length) {
        console.log('Waiting 2s before next batch...');
        await this.delay(2000);
      }
    }

    return results;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new ImageService();