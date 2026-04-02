import scriptService from "./scriptService";
import audioService from "./aud";
import imageService from "./imageService";
import ffmpeg from "fluent-ffmpeg";
import { WordTiming } from "./aud";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import axios from "axios";
import { Scene } from "../../model/Scenes";
import { Video } from "../../model/Video";

import {
  OUT_W,
  OUT_H,
  FPS,
  TransitionPreset,
  SceneEffectConfig,
  SubtitleStyle,
  assignSceneEffects,
  buildSceneFilter,
  buildSubtitleFilter,
} from "./effects";





const mkdir    = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const unlink   = promisify(fs.unlink);
const readdir  = promisify(fs.readdir);



const MIN_SCENE_DURATION = 5; 
const FADE_DURATION      = 0.5; 

interface GeneratedThumbnail{
  focus: string,
  emotion: string,
  visualHook: string,
  textOverlay: string,
  thumbnailUrl: string,
  generatedAt: Date,
}


export interface VideoGenerationOptions {
  duration?:     number;
  genre?:        string;
  language?:     string;
  imageStyle?:   string;
  thumbnail?: GeneratedThumbnail;
  voiceId?:      string;
  outputPath?:   string;
  globalTransition?: TransitionPreset;
  sceneEffects?: Partial<SceneEffectConfig>[];
  subtitleStyle?:    SubtitleStyle;
  disableSubtitles?: boolean;
  bgmPath?: string;       
  bgmVolume?: string;
  scriptProvider? : 'anthropic' | 'groq';
  ttsProvider?: 'elevenlabs' | 'gemini' | 'chimege';      
}

interface SceneWithMedia {
  time:           string;
  scene:          string;
  visual:         string;
  narration:      string;
  imagePrompt:    string;
  audioUrl?:      string;
  imageUrl?:      string;
  audioDuration?: number;
  words?:         WordTiming[];
  ttsProvider?:   string;
  transition?:    TransitionPreset;
  motionEffect?:  string;
}

interface VideoGenerationResult {
  videoId:   string;
  title:     string;
  duration:  string;
  scenes:    SceneWithMedia[];
  status:    "processing" | "completed" | "failed";
  progress:  number;
  thumbnail?: GeneratedThumbnail;  
  createdAt: Date;
  videoPath?: string;
  videoUrl?:  string;
  srtPath?:   string;
}

interface MediaFile {
  image:    string;
  audio?:   string;
  duration: number;
  narration: string;
}

// ─────────────────────────────────────────────────────────────────────────────

class VideoService {
  private tempDir   = path.join(process.cwd(), "temp");
  private outputDir = path.join(process.cwd(), "output");

  constructor() {
    this.ensureDirectories();
  }



  private BGM_LIBRARY: Record<string, string> = {
    "scary1": path.join(process.cwd(), "src", "services", "bgMusic", "scary1.mp3"),
    "education1": path.join(process.cwd(), "src", "services", "bgMusic", "education1.mp3"),
    "education2": path.join(process.cwd(), "src", "services", "bgMusic", "education2.mp3"),
    "history1": path.join(process.cwd(), "src", "services", "bgMusic", "history1.mp3"),
    "history2": path.join(process.cwd(), "src", "services", "bgMusic", "history2.mp3"),
    "stoic1": path.join(process.cwd(), "src", "services", "bgMusic", "stoic1.mp3"),
    "stoic2": path.join(process.cwd(), "src", "services", "bgMusic", "stoic2.mp3"),
    "trueCrime1": path.join(process.cwd(), "src", "services", "bgMusic", "trueCrime1.mp3"),
    "trueCrime2": path.join(process.cwd(), "src", "services", "bgMusic", "trueCrime2.mp3"),
  };



  private async ensureDirectories() {
    try {
      await mkdir(this.tempDir,   { recursive: true });
      await mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error("Error creating directories:", error);
    }
  }



  async generateVideos(
    topic:   string,
    options: VideoGenerationOptions = {},
  ): Promise<VideoGenerationResult> {
    const videoId = this.generateVideoId();


    if (options.bgmPath && !this.BGM_LIBRARY[options.bgmPath]) {
      throw new Error(`Invalid bgmPath "${options.bgmPath}". Choose from: ${Object.keys(this.BGM_LIBRARY).join(", ")}`);
    }

    try {
      console.log(`Starting video gen: ${videoId}`);
      console.log(`Topic: ${topic}`);
      console.log(`Options:`, options);


      console.log("Script gen started...");
      const script = await scriptService.generate(
        topic,
        options.imageStyle || "anime",
        {
          duration: options.duration || 60,
          genre:    options.genre    || "cinematic",
          language: options.language || "en",
          provider: options.scriptProvider ?? 'anthropic'
        },
      );
      console.log(`Script generated: ${script.script.length} scenes`);

      let thumbnail: GeneratedThumbnail | undefined;

      const rawThumbnail = script.thumbnailConcept?.[0];
      if(rawThumbnail){
        console.log("generating thumbnail");
        try{
          thumbnail = await imageService.generateThumbnail(
            rawThumbnail,
            options.imageStyle || 'cinematic'
          );
          console.log(`thumbnail generated: ${thumbnail.thumbnail_url}`);
        }catch(err:any){
          console.warn(`Thumbnail generation failed: ${err.message}`);
        }
      }

      const imagePromises = script.script.map((scene) =>
        imageService.generateSingle(
          { time: scene.time, scene: scene.scene, description: scene.imagePrompt || scene.visual },
          scene.imagePrompt || scene.visual,
        ),
      );


      const processedScenes: SceneWithMedia[] = [];
      for (let i = 0; i < script.script.length; i++) {
        const scene = script.script[i];
        console.log(`[${i + 1}/${script.script.length}] Processing scene: ${scene.time}`);
        const audioResults = await this.generateAudioForScenes([scene], options.voiceId, options.ttsProvider ?? 'gemini');
        processedScenes.push({ ...audioResults[0] } as SceneWithMedia);
      }


      const imageResults = await Promise.allSettled(imagePromises);
      imageResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          processedScenes[index].imageUrl = result.value ?? undefined;
        } else {
          console.warn(
            `  ⚠️  Image failed for scene ${index + 1}:`,
            result.reason?.message,
          );
        }
      });

      const srtPath = options.disableSubtitles
        ? undefined
        : await this.generateSRT(videoId, processedScenes);

      console.log(
        `All scenes processed: ${processedScenes.filter((s) => s.imageUrl).length}/${script.script.length} with images`,
      );

      const videoPath = await this.assembleVideo(
        videoId,
        processedScenes,
        script.title,
        srtPath,
        options,
      );

      // Attach transition and motionEffect to each scene so they get saved to DB
      const narrationScenes = processedScenes.map((s) => ({ narration: s.narration }));
      const sceneEffects    = assignSceneEffects(narrationScenes, options.globalTransition);
      sceneEffects.forEach((eff, i) => {
        if (processedScenes[i]) {
          processedScenes[i].transition   = eff.transition;
          processedScenes[i].motionEffect = eff.motion;
        }
      });

      return {
        videoId,
        title:     script.title,
        duration:  script.duration,
        scenes:    processedScenes,
        status:    "completed",
        progress:  100,
        createdAt: new Date(),
        videoPath,
        videoUrl:  `/output/${videoId}.mp4`,
        srtPath,
        thumbnail,
      };
    } catch (err: any) {
      console.error(`Video generation failed: ${err.message}`);
      throw new Error(`Video generation failed: ${err.message}`);
    }
  }

  async getVideoStatus(videoId: string): Promise<VideoGenerationResult | null> {
    try {
      const video = await Video.findByPk(videoId);
      if (!video) return null;

      const scenes = await Scene.findAll({
        where: { videoId },
        order: [['sceneIndex', 'ASC']],
      });

      const mappedScenes: SceneWithMedia[] = scenes.map(s => ({
        time:          s.time,
        scene:         s.scene,
        visual:        s.imagePrompt ?? '',
        narration:     s.narration   ?? '',
        imagePrompt:   s.imagePrompt ?? '',
        imageUrl:      s.imageUrl    ?? undefined,
        audioUrl:      s.audioUrl    ?? undefined,
        audioDuration: s.audioDuration ?? 0,
        words:         s.words ? JSON.parse(s.words) : [],
        ttsProvider:   s.ttsProvider  ?? 'gemini',
        transition:    (s.transitionType as TransitionPreset) ?? undefined,
        motionEffect:  s.motionEffect  ?? undefined,
        // Attach DB id so the frontend can use reGenImage / reGenNarration
        ...(s.id ? { id: s.id } : {}),
      }));

      return {
        videoId:   video.id,
        title:     video.title,
        duration:  String(video.duration ?? 0),
        scenes:    mappedScenes,
        status:    'completed',
        progress:  100,
        createdAt: new Date(),
        videoUrl:  video.final_video_url ?? undefined,
        srtPath:   video.srtPath ?? undefined,
      };
    } catch (err: any) {
      console.error('getVideoStatus error:', err.message);
      return null;
    }
  }


  async reAssembleVideo(
    videoId: string,
    scenes:  SceneWithMedia[],
    title:   string,
    options: VideoGenerationOptions = {},
  ): Promise<{ videoPath: string; videoUrl: string }> {
    // Reuse existing SRT if present (only skip when explicitly disabled)
    const srtPath = path.join(this.outputDir, `${videoId}.srt`);
    const useSrt = !options.disableSubtitles && fs.existsSync(srtPath);

    console.log(`\n🔁 Re-assembling video: ${videoId}`);
    console.log(`  Scenes: ${scenes.length}, SRT: ${useSrt ? 'yes' : 'no'}`);

    const videoPath = await this.assembleVideo(
      videoId,
      scenes,
      title,
      useSrt ? srtPath : undefined,
      options,
    );

    return { videoPath, videoUrl: `/output/${videoId}.mp4` };
  }


async reGenImage(
  id: string,
  imagePrompt: string,
): Promise<{ imageUrl: string }> {
  const scene = await Scene.findOne({ where: { id } });
  if (!scene) throw new Error(`Scene ${id} not found`);

  scene.imagePrompt = imagePrompt;

  const newImageUrl = await imageService.generateSingle(
    { time: scene.time, scene: scene.scene, description: imagePrompt },
    imagePrompt,
  );

  scene.imageUrl = newImageUrl;
  await scene.save();

  console.log(`  ✓ Image regenerated for scene ${id}: ${newImageUrl.substring(0, 60)}...`);
  return { imageUrl: newImageUrl };
}

async reGenNarration(
  id: string,
  newText: string,
): Promise<{ audioUrl: string; duration: number }> {
  const scene = await Scene.findOne({ where: { id } });
  if (!scene) throw new Error(`Scene ${id} not found`);

  const provider = (scene.ttsProvider as 'elevenlabs' | 'gemini' | 'chimege') || 'gemini';
  console.log(`  Regenerating narration with [${provider}]: ${newText.substring(0, 60)}...`);

  const audioResult = await this.callTTS(provider, newText, scene.voiceId ?? undefined);

  const filename = `audio_${this.generateVideoId()}_scene${scene.sceneIndex}_regen`;
  const newAudioUrl = await audioService.uploadToCloudinary(audioResult.audioBuffer, filename);

  scene.narration    = newText;
  scene.audioUrl     = newAudioUrl;
  scene.audioDuration = audioResult.duration ?? scene.audioDuration;
  await scene.save();

  console.log(`  ✓ Narration + audio updated for scene ${id}`);
  return { audioUrl: newAudioUrl, duration: audioResult.duration ?? 0 };
}



  async regenerateSceneMedia(
    _videoId:        string,
    _sceneIndex:     number,
    regenerateWhat:  "audio" | "image" | "both",
    sceneData?:      { imagePrompt?: string; narration?: string; time?: string; scene?: string },
  ): Promise<Partial<SceneWithMedia>> {
    const result: Partial<SceneWithMedia> = {};

    if ((regenerateWhat === "image" || regenerateWhat === "both") && sceneData?.imagePrompt) {
      console.log(`\n🎨 Regenerating image for scene...`);
      const newImageUrl = await imageService.generateSingle(
        {
          time:        sceneData.time        ?? "",
          scene:       sceneData.scene       ?? "",
          description: sceneData.imagePrompt ?? "",
        },
        sceneData.imagePrompt,
      );
      result.imageUrl = newImageUrl;
      console.log(`  ✓ New image: ${newImageUrl.substring(0, 60)}...`);
    }

    if (regenerateWhat === "audio" || regenerateWhat === "both") {
      throw new Error("Audio regeneration requires database integration to retrieve voice settings");
    }

    return result;
  }



  private async generateAudioForScenes(
    scenes: any[],
    voiceId?: string,
    ttsProvider: 'elevenlabs' | 'gemini' | 'chimege' = 'elevenlabs',
  ): Promise<SceneWithMedia[]> {
    const result: SceneWithMedia[] = [];
  
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
  
      try {
        console.log(`  [${i + 1}/${scenes.length}] Generating audio for: ${scene.time}`);
  
        let audioResult = await this.callTTS(ttsProvider, scene.narration, voiceId);
        

  
        const filename = `audio_${this.generateVideoId()}_scene${i}`;
        const audioUrl = await audioService.uploadToCloudinary(
          audioResult.audioBuffer,
          filename,
        );

        result.push({
          ...scene,
          audioUrl,
          audioDuration: audioResult.duration,
          words: audioResult.words,
          ttsProvider,
        })
  
        console.log(`    ✓ Audio uploaded: ${audioUrl.substring(0, 50)}...`);
        console.log(`    ℹ️  Raw audio duration: ${audioResult.duration}s`);
  
        if (i < scenes.length - 1) await this.delay(500);
      } catch (error: any) {
        console.error(`    ✗ Audio generation failed for scene ${i + 1}: ${error.message}`);
        result.push({
          ...scene,
          audioUrl: undefined,
          audioDuration: undefined,
          words: [],
        });
      }
    }
  
    return result;
  }


  // private async callScriptSer(
  //   provider: 'groq' | 'anthropic',
  //   topic: string,
  //   options: { duration: number; genre: string; language: string; imageStyle: string }
  // ) {
  //   return scriptService.generate
  // }

  private async callTTS(
    provider: 'elevenlabs' | 'gemini' | 'chimege',
    narration: string,
    voiceId?: string
  ){
    switch (provider){
      case 'elevenlabs':
        return audioService.textToSpeechEleven(narration, {
          voice_id: voiceId || 'JBFqnCBsd6RMkjVDRZzb',
          speed: 1.0, pitch: 1.0
        });
        case 'gemini':
          return audioService.textToSpeechGemini(narration,{
            voice_name: voiceId || 'Charon'
          });
        case 'chimege':
          return audioService.textToSpeechChimege(narration,{
            voice_id: voiceId || 'FEMALE3v2',
            speed: 1.0, pitch: 1.0
          });

          default: 
          throw new Error(`Unknown TTS provider: ${provider}`);
    }
  }



  private async generateSRT(
    videoId: string,
    scenes:  SceneWithMedia[],
  ): Promise<string | undefined> {   // ← undefined буцааж болно
    const srtPath = path.join(this.outputDir, `${videoId}.srt`);
  
    let timeOffset = 0;
    const chunks: string[] = [];
  
    for (const scene of scenes) {
      const duration = scene.audioDuration ?? 0;
  
      if (scene.words && scene.words.length > 0) {
        // ElevenLabs / Gemini / Chimege (estimateWordTimings-тай)
        const chunk = audioService.wordsToSRT(scene.words, timeOffset);
        if (chunk.trim()) chunks.push(chunk);
  
      } else if (scene.narration && duration > 0) {
        // Fallback: narration бүхэлд нь нэг subtitle блок болгох
        const chunk = this.narrationToSRTBlock(scene.narration, timeOffset, duration);
        chunks.push(chunk);
      }
  
      timeOffset += duration;
    }
  
    // Хоосон бол SRT файл үүсгэхгүй
    if (chunks.length === 0) {
      console.warn('  ⚠️  No subtitle content — skipping SRT generation');
      return undefined;
    }
  
    const merged = this.reindexSRT(chunks.join('\n\n'));
    await writeFile(srtPath, merged, 'utf-8');
  
    console.log(`SRT saved: ${srtPath}`);
    return srtPath;
  }
  
  // Шинэ helper — нэг бүтэн narration-г нэг SRT блок болгоно
  private narrationToSRTBlock(
    narration: string,
    startOffset: number,
    duration: number,
  ): string {
    const start = this.secondsToSRTTime(startOffset);
    const end   = this.secondsToSRTTime(startOffset + duration);
    // Урт текстийг 42 тэмдэгтээр зүсэх (subtitle стандарт)
    const lines = this.wrapText(narration, 42);
    return `1\n${start} --> ${end}\n${lines}`;
  }
  
  private secondsToSRTTime(seconds: number): string {
    const h   = Math.floor(seconds / 3600);
    const m   = Math.floor((seconds % 3600) / 60);
    const s   = Math.floor(seconds % 60);
    const ms  = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  }
  
  private wrapText(text: string, maxLen: number): string {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length > maxLen) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = (current + ' ' + word).trim();
      }
    }
    if (current) lines.push(current);

    return lines.slice(0, 2).join('\n');
  }

  private reindexSRT(srt: string): string {
    let index = 1;
    return srt.replace(/^\d+$/gm, () => String(index++));
  }



  private async generateImagesForScenes(
    scenes:           SceneWithMedia[],
    backgroundImages: any[],
  ): Promise<SceneWithMedia[]> {
    try {
      const scriptScenes = scenes.map((s) => ({
        time:        s.time,
        scene:       s.scene,
        description: s.imagePrompt || s.visual,
      }));

      const generatedImages = await imageService.generateFromScript(
        scriptScenes,
        backgroundImages,
      );

      const withImages: SceneWithMedia[] = scenes.map((scene, index) => {
        const img = generatedImages.find((g) => g.sceneTime === scene.time);
        let imageUrl = img?.imageUrl;

        if (imageUrl && !imageUrl.startsWith("http")) {
          if (!path.isAbsolute(imageUrl)) imageUrl = path.resolve(imageUrl);
          console.log(`  ℹ️  Using absolute path: ${imageUrl}`);
        }

        return { ...scene, imageUrl: imageUrl || undefined };
      });

      const successCount = withImages.filter((s) => s.imageUrl).length;
      console.log(`✅ Images: ${successCount}/${scenes.length} successful`);

      return this.uploadLocalImagesToCloudinary(withImages);
    } catch (error: any) {
      console.error("❌ Image generation error:", error.message);
      return scenes.map((s) => ({ ...s, imageUrl: undefined }));
    }
  }

  private async uploadLocalImagesToCloudinary(
    scenes: SceneWithMedia[],
  ): Promise<SceneWithMedia[]> {
    const cloudinary = require("cloudinary").v2;

    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      console.warn("⚠️  Cloudinary not configured - keeping local paths");
      return scenes;
    }

    cloudinary.config({
      cloud_name:  process.env.CLOUDINARY_CLOUD_NAME,
      api_key:     process.env.CLOUDINARY_API_KEY,
      api_secret:  process.env.CLOUDINARY_API_SECRET,
    });

    const updated: SceneWithMedia[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      if (!scene.imageUrl || scene.imageUrl.startsWith("http")) {
        updated.push(scene);
        continue;
      }

      try {
        console.log(`  [${i + 1}/${scenes.length}] Uploading local image to Cloudinary...`);
        const result = await cloudinary.uploader.upload(scene.imageUrl, {
          folder:        "ai-generated-images",
          resource_type: "image",
        });
        console.log(`    ✓ Uploaded: ${result.secure_url.substring(0, 50)}...`);
        updated.push({ ...scene, imageUrl: result.secure_url });
      } catch (err: any) {
        console.error(`    ✗ Upload failed: ${err.message}`);
        updated.push(scene);
      }
    }

    return updated;
  }



  private async assembleVideo(
    videoId:  string,
    scenes:   SceneWithMedia[],
    title:    string,
    srtPath?: string,
    options:  VideoGenerationOptions = {},
  ): Promise<string> {
    const tempVideoDir = path.join(this.tempDir, videoId);
    await mkdir(tempVideoDir, { recursive: true });

    try {

      if (options.bgmPath && this.BGM_LIBRARY[options.bgmPath]) {
        options.bgmPath = this.BGM_LIBRARY[options.bgmPath];
      } else if (options.bgmPath && !fs.existsSync(options.bgmPath)) {

        console.warn(`  ⚠️  BGM path not found, skipping: ${options.bgmPath}`);
        options.bgmPath = undefined;
      }

      console.log(`\n🔧 Preparing media files...`);
      const mediaFiles = await this.downloadSceneMedia(scenes, tempVideoDir);

      console.log("\n📊 Scene duration summary:");
      mediaFiles.forEach((m, i) => {
        console.log(
          `  Scene ${i + 1}: ${m.duration.toFixed(2)}s  ` +
          `image=${path.basename(m.image)}  ` +
          `audio=${m.audio ? path.basename(m.audio) : "none"}`,
        );
      });

      const totalDuration =
        mediaFiles.reduce((s, m) => s + m.duration, 0) -
        FADE_DURATION * (mediaFiles.length - 1);
      console.log(`Expected video length: ~${totalDuration.toFixed(1)}s`);

      console.log(`\nCreating video with FFmpeg...`);
      const outputPath = path.join(options.outputPath ?? this.outputDir, `${videoId}.mp4`);

      await this.createVideoWithFFmpeg(mediaFiles, outputPath, title, srtPath, options);

      console.log(`\nVideo created successfully!`);
      await this.cleanupTempFiles(tempVideoDir);

      return outputPath;
    } catch (error: any) {
      console.error(`\nVideo assembly failed: ${error.message}`);
      throw error;
    }
  }

  private async downloadSceneMedia(
    scenes:  SceneWithMedia[],
    tempDir: string,
  ): Promise<MediaFile[]> {
    const mediaFiles: MediaFile[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      console.log(`  [${i + 1}/${scenes.length}] Preparing media...`);


      let imagePath: string | undefined;

      if (scene.imageUrl) {
        try {
          if (scene.imageUrl.startsWith("http")) {
            imagePath = path.join(tempDir, `scene_${i}_image.png`);
            await this.downloadFile(scene.imageUrl, imagePath);
            console.log(`    ✓ Image downloaded from URL`);
          } else if (fs.existsSync(scene.imageUrl)) {
            imagePath = path.isAbsolute(scene.imageUrl)
              ? scene.imageUrl
              : path.resolve(scene.imageUrl);
            console.log(`    ✓ Using local image: ${imagePath}`);
          } else {
            console.error(`    ✗ Local file not found: ${scene.imageUrl}`);
          }
        } catch (err: any) {
          console.error(`    ✗ Image preparation failed: ${err.message}`);
        }
      } else {
        console.warn(`      No image URL for scene ${i + 1} - skipping`);
      }


      let audioPath: string | undefined;

      if (scene.audioUrl) {
        try {
          audioPath = path.join(tempDir, `scene_${i}_audio.mp3`);
          await this.downloadFile(scene.audioUrl, audioPath);
          console.log(`    ✓ Audio downloaded`);
        } catch (err: any) {
          console.error(`    ✗ Audio download failed: ${err.message}`);
        }
      }

      if (!imagePath) {
        console.warn(`      Skipping scene ${i + 1} - no valid image`);
        continue;
      }


      let sceneDuration: number;

      if (audioPath) {
        const probed = await this.probeAudioDuration(audioPath);
        if (probed > 0) {
          sceneDuration = probed + FADE_DURATION;
          console.log(
            `    ✓ Probed: ${probed.toFixed(2)}s (+${FADE_DURATION}s tail → ${sceneDuration.toFixed(2)}s)`,
          );
        } else {
          const fallback = scene.audioDuration ?? 0;
          sceneDuration  = Math.max(fallback, MIN_SCENE_DURATION);
          console.log(`      ffprobe failed, using fallback: ${sceneDuration.toFixed(2)}s`);
        }
      } else {
        sceneDuration = MIN_SCENE_DURATION;
        console.log(`     No audio, scene held for ${sceneDuration}s`);
      }

      mediaFiles.push({
        image:    imagePath,
        audio:    audioPath,
        duration: sceneDuration,
        narration: scene.narration ?? "",
      });
    }

    if (mediaFiles.length === 0) {
      throw new Error("No valid scenes with images found. Cannot create video.");
    }

    console.log(`\n  ${mediaFiles.length}/${scenes.length} scenes ready for video assembly`);

    return mediaFiles;
  }



  private probeAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
        if (err || !metadata?.format?.duration) resolve(0);
        else resolve(parseFloat(metadata.format.duration) || 0);
      });
    });
  }



  private async downloadFile(url: string, outputPath: string): Promise<void> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios({ url, method: "GET", responseType: "arraybuffer", timeout: 15000 });
        await writeFile(outputPath, response.data);
        return;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`    ⚠️  Download attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
        if (attempt < maxRetries) await this.delay(1500 * attempt);
      }
    }

    throw new Error(`Download failed after ${maxRetries} attempts: ${lastError?.message}`);
  }



  private createVideoWithFFmpeg(
    mediaFiles: MediaFile[],
    outputPath: string,
    _title:     string,
    srtPath?:   string,
    options:    VideoGenerationOptions = {},
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const genre = options.genre ?? "cinematic";

      const narrationScenes = mediaFiles.map((m) => ({ narration: m.narration }));
      const autoEffects     = assignSceneEffects(narrationScenes, options.globalTransition);

      const effectConfigs: SceneEffectConfig[] = autoEffects.map((auto, i) => ({
        ...auto,
        ...(options.sceneEffects?.[i] ?? {}),
      }));


const srtExists = srtPath ? fs.existsSync(srtPath) : false;

const subtitleFilter =
  !options.disableSubtitles && srtPath && srtExists 
    ? buildSubtitleFilter(srtPath, options.subtitleStyle)
    : null;

if (srtPath && !srtExists) {
  console.warn(`  ⚠️  SRT файл олдсонгүй, хадмалгүй үүсгэж байна: ${srtPath}`);
}

      let command = ffmpeg();
      let fcScriptPath: string | null = null;


      if (mediaFiles.length === 1) {
        const cfg     = effectConfigs[0];
        const sceneVf = buildSceneFilter(cfg.motion, mediaFiles[0].duration, cfg.impact, genre);
        const finalVf = subtitleFilter ? `${sceneVf},${subtitleFilter}` : sceneVf;

        command
          .input(mediaFiles[0].image)
          .inputOptions(["-loop", "1", "-t", String(mediaFiles[0].duration)]);

        if (mediaFiles[0].audio) command.input(mediaFiles[0].audio);

        command.outputOptions(["-map", "0:v", "-vf", finalVf]);
        if (mediaFiles[0].audio) command.outputOptions(["-map", "1:a", "-shortest"]);


      } else {
        const N = mediaFiles.length;


        mediaFiles.forEach((m) =>
          command.input(m.image).inputOptions(["-loop", "1", "-t", String(m.duration)]),
        );


        const audioIndices: number[] = [];
        mediaFiles.forEach((m, i) => {
          if (m.audio) { command.input(m.audio); audioIndices.push(i); }
        });

        let bgmInputIdx = -1;
        if (options.bgmPath && fs.existsSync(options.bgmPath)) {
          command.input(options.bgmPath).inputOptions(["-stream_loop", "-1"]);
          bgmInputIdx = N + audioIndices.length;
        }

        let filterComplex = "";

        // 1. Per-clip: prescale + zoompan + atmosphere
        for (let i = 0; i < N; i++) {
          const cfg     = effectConfigs[i];
          const sceneVf = buildSceneFilter(cfg.motion, mediaFiles[i].duration, cfg.impact, genre);
          filterComplex += `[${i}:v]${sceneVf}[sv${i}];`;
        }

        // 2. xfade chain
        let cumulativeDuration = 0;
        let prev = "sv0";

        for (let i = 1; i < N; i++) {
          cumulativeDuration += mediaFiles[i - 1].duration;
          const offset     = Math.max(0, cumulativeDuration - FADE_DURATION * i);
          const rawTransition = effectConfigs[i-1]?.transition || "fade";

          const isLast     = i === N - 1;
          const out        = isLast ? (subtitleFilter ? "outv_raw" : "outv") : `v${i}`;

          const xfadeTransition = rawTransition === "hard-cut" ? "fade" : rawTransition;
          const xfadeDuration   = rawTransition === "hard-cut" ? 0.03 : FADE_DURATION;

          filterComplex +=
            `[${prev}][sv${i}]xfade=transition=${xfadeTransition}:duration=${xfadeDuration}:offset=${offset}[${out}];`;

          prev = out;
        }

        // 3. Subtitle on final stream
        if (subtitleFilter) {
          filterComplex += `[outv_raw]${subtitleFilter}[outv];`;
        }

        // 4. Audio concat + optional BGM mix
        if (audioIndices.length > 0) {
          const narrLabels = audioIndices.map((_, idx) => `[${N + idx}:a]`).join("");
          const volume = options.bgmVolume ? parseFloat(options.bgmVolume) : 0.15;
        
          filterComplex += `${narrLabels}concat=n=${audioIndices.length}:v=0:a=1[narr_raw];`;
        
          if (bgmInputIdx !== -1) {
            filterComplex += `[${bgmInputIdx}:a]volume=${volume}[bgm_low];`;
            // ✅ duration=first — narration дуусахад BGM ч дуусна
            filterComplex += `[narr_raw][bgm_low]amix=inputs=2:duration=first:dropout_transition=2[outa]`;
          } else {
            // ✅ apad устгасан
            filterComplex += `[narr_raw]acopy[outa]`;
          }
        
          filterComplex = filterComplex.replace(/;$/, "");
        }

        // Write filter complex to a file for debugging, then use the new
        // FFmpeg 7.x syntax (-/filter_complex file) instead of the deprecated
        // -filter_complex_script which was removed in FFmpeg 7.1.x.
        fcScriptPath = outputPath.replace('.mp4', '_fc.txt');
        console.log('\n========== FILTER COMPLEX ==========\n' + filterComplex + '\n====================================\n');
        fs.writeFileSync(fcScriptPath, filterComplex, 'utf8');

        // Use fluent-ffmpeg's complexFilter() which passes -filter_complex inline,
        // supported by all FFmpeg versions and avoids the deprecated _script option.
        command.complexFilter(filterComplex);
        command.outputOptions(["-map", "[outv]"]);
        if (audioIndices.length > 0) {
          command.outputOptions(["-map", "[outa]"]);
          // FIX: only add -shortest when there is NO bgm (amix handles duration itself)
          if (bgmInputIdx === -1) {
            command.outputOptions(["-shortest"]);
          }
        }
      }
      const totalDuration =
  mediaFiles.reduce((s, m) => s + m.duration, 0) -
  FADE_DURATION * (mediaFiles.length - 1);

console.log(`  🎯 Output duration capped at: ${totalDuration.toFixed(2)}s`);

      command
        .output(outputPath)
        .outputOptions([
          "-t", totalDuration.toFixed(3),
          "-c:v",    "libx264",
          "-preset", "medium",
          "-crf",    "23",
          "-pix_fmt","yuv420p",
          "-c:a",    "aac",
          "-b:a",    "192k",
          "-ar",     "44100",
        ])
        .on("start",    (cmd) => console.log("FFmpeg:", cmd))
        .on("stderr",   (line) => console.log("  ffmpeg stderr:", line))
        .on("progress", (p)   => { if (p.percent) console.log(`  ${Math.round(p.percent)}%`); })
        .on("end",      ()    => {
          console.log("  ✓ Done");
          if (fcScriptPath) try { fs.unlinkSync(fcScriptPath); } catch {}
          resolve();
        })
        .on("error",    (err) => {
          console.error("  ✗ FFmpeg error:", err.message);
          // Keep fc.txt on error so we can inspect the filter content
          // if (fcScriptPath) try { fs.unlinkSync(fcScriptPath); } catch {}
          reject(err);
        })
        .run();
    });
  }



  private async cleanupTempFiles(tempDir: string): Promise<void> {
    try {
      const files = await readdir(tempDir);
      for (const file of files) await unlink(path.join(tempDir, file));
      await fs.promises.rmdir(tempDir);
      console.log(`  ✓ Cleaned up temporary files`);
    } catch (error) {
      console.error("  ⚠️  Cleanup failed:", error);
    }
  }



  private generateVideoId(): string {
    return `vid_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new VideoService();