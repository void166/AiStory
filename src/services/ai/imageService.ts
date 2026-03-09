import client from 'magic-hour';
import { GoogleGenAI } from '@google/genai';
import { config } from '../../config';

const {MAGICHOUR_API,GEMINI_API_KEY } = config;

interface genSingleStyle{
  visual: string;
  narration: string;
  imagePrompt: string
}

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
  private geminiApi: any;

  constructor() {
    this.magicHour = new client({
      token: process.env.MAGICHOUR_API || ''
    });
    this.geminiApi = new GoogleGenAI({
      apiKey: GEMINI_API_KEY
    })
  }

  // async generateFromScript(
  //   scenes: ScriptScene[],
  //   backgroundImages: BackgroundImage[]
  // ):Promise<GeneratedImage[]>{
  //   console.log(`starting generation for ${scenes.length} scenes ...`);

  //   const result : GeneratedImage[] = [];

  //   for(let i=0; i<scenes.length; i++){
  //     const scene = scenes[i];

  //     try{
  //       console.log(`[${i+1}/${scenes.length}] generating image for scene: ${scene.time}`);

  //       const bgImage = this.findMatchingBackground(scene, backgroundImages);

  //       const imageUrl = await this.generateSingle(
  //         scene,
  //         bgImage?.prompt,
  //         bgImage?.style
  //       );

  //       result.push({
  //         sceneTime: scene.time,
  //         imageUrl,
  //         prompt: bgImage?.prompt || scene.description,
  //         backgroundImageId: bgImage?.id,
  //         generatedAt: new Date()
  //       });

  //       if(i<scenes.length-1){
  //         console.log("waiting 1s before next generation,,");
  //       }
  //     }catch(err:any){
  //       console.error(`failed to generate image for scene ${scene.time}: `, err.message);

  //       result.push({
  //         sceneTime: scene.time,
  //         imageUrl: '',
  //         prompt: scene.description,
  //         generatedAt: new Date()
  //   })
  //     }
  //   }
  // }

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

        const bgImage = this.findMatchingBackground(scene, backgroundImages);

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

        if (i < scenes.length - 1) {
          console.log('Waiting 1s before next generation...');
          await this.delay(1000);
        }

      } catch (error: any) {
        console.error(`Failed to generate image for scene ${scene.time}:`, error.message);
        
        results.push({
          sceneTime: scene.time,
          imageUrl: '', 
          prompt: scene.description,
          generatedAt: new Date()
        });
      }
    }

    console.log(`Generation complete: ${results.filter(r => r.imageUrl).length}/${scenes.length} successful`);

    return results;
  }

  async generateSingle(
    scene: ScriptScene,
    customPrompt?: string,
    customStyle?: { prompt?: string; type?: string; intensity?: number }
  ): Promise<string> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const rawPrompt = customPrompt || this.buildPrompt(scene);
        const prompt = this.wrapPromptForPortrait(rawPrompt);
        console.log(`🔄 Attempt ${attempt}/${maxRetries}: ${prompt.substring(0, 60)}...`);

        // ── Call Gemini image generation ──────────────────────────────────
        const response = await this.geminiApi.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        });

        // ── Extract inline image from response parts ──────────────────────
        // Gemini returns: response.candidates[0].content.parts[]
        // Each part is { text } or { inlineData: { data: string (base64), mimeType: string } }
        const parts = response.candidates?.[0]?.content?.parts ?? [];

        let base64Image: string | undefined;
        let mimeType = 'image/png';

        for (const part of parts) {
          if (part.inlineData?.data) {
            base64Image = part.inlineData.data;    // ← this is the actual image!
            mimeType    = part.inlineData.mimeType || 'image/png';
            break;
          }
          if (part.text) {
            console.log(`📝 Gemini text: ${part.text.substring(0, 100)}`);
          }
        }

        if (!base64Image) {
          console.error('No image in Gemini response. Parts:', JSON.stringify(parts, null, 2));
          throw new Error('Gemini returned no image data.');
        }

        console.log(`✅ Got base64 image (${mimeType}), uploading to Cloudinary...`);

        // ── Upload base64 → Cloudinary ────────────────────────────────────
        const cloudUrl = await this.uploadBase64ToCloudinary(base64Image, mimeType);
        console.log(`☁️  Cloudinary URL: ${cloudUrl.substring(0, 80)}...`);
        return cloudUrl;

      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ Attempt ${attempt} failed:`, lastError.message);

        if (error?.status === 429 && attempt < maxRetries) {
          const wait = Math.pow(2, attempt) * 1000;
          console.log(`⏳ Rate limited. Waiting ${wait}ms...`);
          await this.delay(wait);
          continue;
        }

        if (attempt < maxRetries) await this.delay(1000);
      }
    }

    throw new Error(
      `Image generation failed after ${maxRetries} attempts: ${lastError?.message ?? 'Unknown error'}`
    );
  }

  async generateCustom(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<string> {
    try {
      const styleConfig = {
        prompt: options?.style?.prompt || prompt,
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


      let imageResult: string | undefined;
      
      if (response?.downloads?.[0]?.url) {
        imageResult = response.downloads[0].url;
      } else if (response?.downloadedPaths?.[0]) {
        imageResult = response.downloadedPaths[0];
      } else if (response?.data?.[0]?.url) {
        imageResult = response.data[0].url;
      } else if (response?.data?.[0]?.path) {
        imageResult = response.data[0].path;
      } else if (response?.data?.[0] && typeof response.data[0] === 'string') {
        imageResult = response.data[0];
      } else if (response?.url) {
        imageResult = response.url;
      } else if (response?.path) {
        imageResult = response.path;
      }


      if (!imageResult) {
        console.error('Invalid response structure:', JSON.stringify(response, null, 2));
        throw new Error('Invalid response from Magic Hour API - no URL or path found');
      }

      // Log result (TypeScript now knows imageResult is string)
      if (imageResult.startsWith('http')) {
        console.log(`✓ Got cloud URL: ${imageResult.substring(0, 80)}...`);
      } else {
        console.log(`✓ Got local path: ${imageResult}`);
      }

      // Upload local files to Cloudinary
      if (imageResult.startsWith('/') || imageResult.includes('Desktop') || imageResult.includes('output-')) {
        console.log(`⬆️  Uploading to Cloudinary...`);
        
        const fs = require('fs');
        const cloudinary = require('cloudinary').v2;
        
        if (!cloudinary.config().cloud_name) {
          cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
          });
        }
        
        try {
          const uploadResult = await cloudinary.uploader.upload(imageResult, {
            folder: 'ai-generated-images',
            resource_type: 'image'
          });
          
          console.log(`✓ Uploaded: ${uploadResult.secure_url.substring(0, 80)}...`);
          return uploadResult.secure_url;
        } catch (uploadError: any) {
          console.error('Cloudinary upload failed:', uploadError.message);
          console.warn('⚠️  Using local path');
          return imageResult;
        }
      }

      console.log(`✓ Using URL: ${imageResult.substring(0, 80)}...`);
      return imageResult;

    } catch (error: any) {
      console.error('Custom image generation failed:', error);
      throw new Error(`Failed to generate custom image: ${error.message}`);
    }
  }

  private buildPrompt(scene: ScriptScene): string {
    const subject = scene.scene || '';
    const detail  = scene.description || '';
    if (!subject && !detail) return 'A dramatic cinematic scene';
    return [subject, detail].filter(Boolean).join('. ');
  }

  // ─── Wrap any raw prompt in a strict portrait + composition instruction ──────
  // Gemini responds well to structured imperative prompts. Separating the
  // subject description from the technical requirements makes it much more
  // likely to obey every constraint.
  private wrapPromptForPortrait(rawPrompt: string): string {
    return `
Generate a VERTICAL PORTRAIT illustration with the following specifications.

SUBJECT & SCENE:
${rawPrompt}

MANDATORY TECHNICAL REQUIREMENTS (follow all — non-negotiable):
1. ORIENTATION: Portrait / vertical format. The image must be TALLER than it is wide (9:16 ratio). This is for a mobile phone screen. If you generate a landscape or square image, it is wrong.
2. RESOLUTION TARGET: Compose for 1080 × 1920 pixels (portrait).
3. COMPOSITION: Main subject must be centered both horizontally and vertically. Leave at least 10% safe margin on the left and right edges. Important elements must NOT be cut off or placed at the very edge.
4. SUBJECT VISIBILITY: Every visual element mentioned in the scene description must be fully visible and clearly rendered — nothing cropped, nothing hidden behind edges.
5. FOCAL POINT: Place the primary subject in the center third of the frame. Avoid placing key objects near the corners.
6. NO TEXT: Do not add any text, watermarks, labels, or UI overlays onto the image.
7. SINGLE FRAME: One complete illustration only. No comic panels, no split screens.
`.trim();
  }

  private findMatchingBackground(
    scene: ScriptScene,
    backgroundImages: BackgroundImage[]
  ): BackgroundImage | undefined {
    if (!backgroundImages || backgroundImages.length === 0) {
      return undefined;
    }

    const timeMatch = scene.time.match(/^(\d+)-/);
    if (!timeMatch) return backgroundImages[0];

    const startTime = parseInt(timeMatch[1]);
    const imageIndex = Math.floor(startTime / 10);

    return backgroundImages[imageIndex] || backgroundImages[backgroundImages.length - 1];
  }

  private sanitizePrompt(prompt: string): string {
    const sensitiveWords = [
      'blood', 'gore', 'violent', 'explicit', 'nude', 
      'sexual', 'weapon', 'death', 'kill', 'murder',
      'horror', 'scary', 'terrifying', 'nightmare'
    ];

    let sanitized = prompt;

    sensitiveWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      sanitized = sanitized.replace(regex, '');
    });

    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    sanitized += '. Artistic, cinematic, professional';

    return sanitized;
  }

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

      if (i + batchSize < scenes.length) {
        console.log('Waiting 2s before next batch...');
        await this.delay(2000);
      }
    }

    return results;
  }

  private async uploadBase64ToCloudinary(base64: string, mimeType: string): Promise<string> {
    const cloudinary = require('cloudinary').v2;

    if (!cloudinary.config().cloud_name) {
      cloudinary.config({
        cloud_name: config.CLOUDNAME,
        api_key: config.CLOUD_API_KEY,
        api_secret: config.CLOUD_API_SECRET,
      });
    }

    const dataUri = `data:${mimeType};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'ai-generated-images',
      resource_type: 'image',
    });

    return result.secure_url;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new ImageService();