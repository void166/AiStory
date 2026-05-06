import client from 'magic-hour';
import { GoogleGenAI } from '@google/genai';
import { config } from '../../config';
import fs from 'fs';
import path from 'path';

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

export interface ThumbnailConcept{
  focus: string,
  emotion: string,
  visualHook: string,
  textOverlay: string
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
interface GeneratedThumbnail{
  focus: string,
  emotion: string,
  visualHook: string,
  textOverlay: string,
  thumbnailUrl: string,
  generatedAt: Date,
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


    private THUMBNAIL_STYLE: Record<string, string> = {
      comic:
        "American comic-book poster style, bold black ink contours, graphic shadow shapes, punchy saturated colors, sharp visual hierarchy, dramatic halftone texture, stylized but readable action framing",
    
      creepyComic:
        "dark horror-comic poster style, scratchy ink texture, warped visual tension, dirty desaturated palette, oppressive shadow masses, eerie negative space, unsettling focal composition, disturbing but highly readable imagery",
    
      modernCartoon:
        "premium modern cartoon poster style, clean contour lines, simplified high-readability shapes, vibrant polished colors, expressive character posing, friendly but cinematic framing, social-media-ready cover illustration",
    
      stylized3DAnimation:
        "cinematic stylized 3D animated-film poster style, expressive faces, polished render quality, rich color depth, soft global illumination, emotionally clear storytelling, premium animated key-art look",
    
      anime:
        "cinematic anime key-visual style, emotionally intense character framing, polished cel shading, atmospheric depth, vivid highlight contrast, elegant background simplification, premium film-poster composition",
    
      satiricalFlatCartoon:
        "flat satirical cartoon poster style, bold clean outlines, flat cel shading, exaggerated comedic expressions, bright readable palette, humorous character-driven staging, iconic TV-poster energy",
    
      cinematic:
        "cinematic blockbuster poster style, dramatic lens-driven framing, deep contrast, realistic texture emphasis, intense emotional focus, premium key art lighting, sharp subject isolation, movie-poster level impact",
    
      darkCinematic:
        "dark thriller poster style, cold moody palette, deep blacks, razor-sharp highlights, ominous contrast, suspense-heavy framing, tense cinematic realism, visually oppressive but highly readable focal design",
    
      hyperReal:
        "hyper-real poster style, ultra-detailed textures, dramatic realism, premium studio lighting, crystal-clear subject emphasis, visually intense emotional realism, luxury poster-quality finish",
    
      viralShock:
        "high-click viral thumbnail style, exaggerated emotion, instant visual readability, aggressive contrast separation, oversized focal expression, simplified background storytelling, engineered for maximum attention in a fast-scrolling feed",
    
      mystery:
        "mystery-poster style, selective revelation lighting, suspenseful shadow composition, restrained palette, intriguing symbolic focal detail, eerie cinematic silence, curiosity-driven visual storytelling",
    
      historicalEpic:
        "historical epic poster style, monumental scale, heroic or tragic focal staging, rich material textures, dramatic golden or storm-lit atmosphere, painterly realism, prestigious cinematic period-drama energy",
    
      neonDrama:
        "neon-charged dramatic poster style, luminous rim lighting, electric accent colors, deep urban shadows, high-impact modern contrast, stylish synthetic atmosphere, bold futuristic cover composition"
    };


    async generateThumbnail(
      thumbnail: ThumbnailConcept,
      style: string = 'cinematic'
    ): Promise<GeneratedThumbnail>{
      console.log(`starting generating thumbnail pic`);
      console.log(`style: ${style}`);
      console.log(`emotion: ${thumbnail.emotion}`);
      console.log(`focus: ${thumbnail.focus}`);
      console.log(`textOverlay: ${thumbnail.textOverlay}`);
      console.log(`visualHook: ${thumbnail.visualHook}`);

      const stylePrompt =
      this.THUMBNAIL_STYLE[style] ??
      this.THUMBNAIL_STYLE['cinematic'];

      const imagePrompt = `
      Thumbnail concept:
      Focus:      ${thumbnail.focus}
      Emotion:    ${thumbnail.emotion}
      Visual hook: ${thumbnail.visualHook}
      
      Visual style: ${stylePrompt}
      
      COMPOSITION RULES (mandatory):
      - Portrait vertical format, 1080x1920, mobile-first
      - Main subject centered horizontally and vertically
      - Leave at least 10% safe margin on left and right edges
      - Nothing important cropped at the edges
      - Bold, high-contrast visuals engineered for instant attention in a feed
      - No text, watermarks, or UI overlays on the image
        `.trim();

        const dummyScene: ScriptScene = {
          time: '0:00',
          scene: thumbnail.focus,
          description: thumbnail.visualHook,
        };
      
        const thumbnailUrl = await this.generateSingle(
          dummyScene,
          imagePrompt, 
        );
      
        return {
          focus:        thumbnail.focus,
          emotion:      thumbnail.emotion,
          visualHook:   thumbnail.visualHook,
          textOverlay:  thumbnail.textOverlay,
          thumbnailUrl,
          generatedAt:  new Date(),
        };
      
    }
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
    customStyle?: { prompt?: string; type?: string; intensity?: number },
    onCloudinaryDone?: (cloudUrl: string) => void,
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

        console.log(`✅ Got base64 image (${mimeType}), saving locally...`);

        // ── Save locally first (fast, no timeout risk) ────────────────────
        const localPath = await this.saveBase64Locally(base64Image, mimeType);
        console.log(`💾 Saved locally: ${path.basename(localPath)}`);

        // ── Upload to Cloudinary in background (non-blocking) ─────────────
        this.uploadBase64ToCloudinary(base64Image, mimeType).then(cloudUrl => {
          console.log(`☁️  Cloudinary async upload done: ${cloudUrl.substring(0, 60)}...`);
          onCloudinaryDone?.(cloudUrl);   // ← notify caller so it can update DB
        }).catch(err => {
          console.warn(`⚠️  Cloudinary async upload failed (local path still usable): ${err.message}`);
        });

        return localPath;

      } catch (error: any) {
        // Cloudinary / Gemini SDKs sometimes throw plain objects, not Error instances.
        // String(plainObject) === "[object Object]", which loses the real message.
        const realMsg =
          error?.message
          ?? error?.error?.message
          ?? error?.response?.data?.error?.message
          ?? (typeof error === 'object' ? JSON.stringify(error) : String(error));
        lastError = error instanceof Error ? error : new Error(realMsg);
        console.error(`❌ Attempt ${attempt} failed:`, realMsg);
        if (error?.http_code) console.error(`   http_code: ${error.http_code}`);
        if (error?.name)      console.error(`   name: ${error.name}`);

        const isRetryable =
          error?.status === 429 ||
          error?.http_code === 429 ||
          error?.http_code === 499 ||   // Cloudinary timeout
          error?.status === 503 ||      // Gemini overload
          realMsg.includes('timeout') ||
          realMsg.includes('UNAVAILABLE');

        if (isRetryable && attempt < maxRetries) {
          const wait = Math.pow(2, attempt) * 2000;
          console.log(`⏳ Retrying in ${wait / 1000}s...`);
          await this.delay(wait);
          continue;
        }

        if (attempt < maxRetries) await this.delay(1500);
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

  private async saveBase64Locally(base64: string, mimeType: string): Promise<string> {
    const ext = mimeType.includes('jpeg') ? 'jpg' : 'png';
    const imgDir = path.join(process.cwd(), 'output', 'images');
    fs.mkdirSync(imgDir, { recursive: true });
    const filename = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    const filePath = path.join(imgDir, filename);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return filePath;
  }

  private async uploadBase64ToCloudinary(base64: string, _mimeType: string): Promise<string> {
    const cloudinary = require('cloudinary').v2;

    // Always override — system env CLOUDINARY_CLOUD_NAME can shadow .env values
    cloudinary.config({
      cloud_name: config.CLOUDNAME,
      api_key:    config.CLOUD_API_KEY,
      api_secret: config.CLOUD_API_SECRET,
    });

    if (!config.CLOUDNAME || !config.CLOUD_API_KEY || !config.CLOUD_API_SECRET) {
      throw new Error(
        `Cloudinary credentials missing in config: CLOUDNAME=${!!config.CLOUDNAME}`
      );
    }

    const buffer = Buffer.from(base64, 'base64');
    console.log(`  → Cloudinary upload (${(buffer.length / 1024).toFixed(1)} KB)...`);

    return new Promise<string>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'ai-generated-images',
          resource_type: 'image',
          timeout: 60000,
        },
        (error: any, result: any) => {
          if (error) {
            // Cloudinary errors are { message, http_code, name }
            const msg = error?.message
              ?? error?.error?.message
              ?? JSON.stringify(error);
            return reject(new Error(`Cloudinary: ${msg} (http_code=${error?.http_code ?? 'n/a'})`));
          }
          if (!result?.secure_url) {
            return reject(new Error('Cloudinary returned no secure_url'));
          }
          resolve(result.secure_url);
        }
      );
      stream.end(buffer);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new ImageService();