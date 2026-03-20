// ─────────────────────────────────────────────────────────────────────────────
// services/videoService.ts
// ─────────────────────────────────────────────────────────────────────────────

import scriptService from "./scriptService";
import audioService from "./aud";
import imageService from "./imageService";
import ffmpeg from "fluent-ffmpeg";
import { WordTiming } from "./aud";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import axios from "axios";

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

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_SCENE_DURATION = 5;  // seconds — floor when there is no audio
const FADE_DURATION      = 0.5; // seconds — xfade overlap between clips



export interface VideoGenerationOptions {
  duration?:     number;
  /** 'scary' | 'education' | 'vintage' | 'cinematic'  (default: 'cinematic') */
  genre?:        string;
  language?:     string;
  imageStyle?:   string;
  voiceId?:      string;
  outputPath?:   string;

  // ── Effect overrides exposed to callers ──────────────────────────────────
  /** Force the same transition for every scene instead of auto-selecting */
  globalTransition?: TransitionPreset;
  /**
   * Per-scene effect overrides; index matches the scene order.
   * Unspecified fields fall back to auto-assigned values.
   */
  sceneEffects?: Partial<SceneEffectConfig>[];

  // ── Subtitle options ─────────────────────────────────────────────────────
  subtitleStyle?:    SubtitleStyle;
  disableSubtitles?: boolean;
}

interface SceneWithMedia {
  time:          string;
  scene:         string;
  visual:        string;
  narration:     string;
  imagePrompt:   string;
  audioUrl?:     string;
  imageUrl?:     string;
  audioDuration?: number;
  words?:        WordTiming[];
}

interface VideoGenerationResult {
  videoId:   string;
  title:     string;
  duration:  string;
  scenes:    SceneWithMedia[];
  status:    "processing" | "completed" | "failed";
  progress:  number;
  createdAt: Date;
  videoPath?: string;
  videoUrl?:  string;
  srtPath?:   string;
}

/** Internal per-clip descriptor passed to the FFmpeg assembler */
interface MediaFile {
  image:    string;
  audio?:   string;
  duration: number;
  /** Forwarded from the scene so effects.ts can derive impact */
  narration: string;
}

// ─────────────────────────────────────────────────────────────────────────────

class VideoService {
  private tempDir   = path.join(process.cwd(), "temp");
  private outputDir = path.join(process.cwd(), "output");

  constructor() {
    this.ensureDirectories();
  }

  // ─── Directory helpers ──────────────────────────────────────────────────────

  private async ensureDirectories() {
    try {
      await mkdir(this.tempDir,   { recursive: true });
      await mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error("Error creating directories:", error);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async generateVideos(
    topic:   string,
    options: VideoGenerationOptions = {},
  ): Promise<VideoGenerationResult> {
    const videoId = this.generateVideoId();

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
        },
      );
      console.log(`Script generated: ${script.script.length} scenes`);

      // Start all image generations in parallel
      const imagePromises = script.script.map((scene) =>
        imageService.generateSingle(
          { time: scene.time, scene: scene.scene, description: scene.imagePrompt || scene.visual },
          scene.imagePrompt || scene.visual,
        ),
      );

      // Generate audio sequentially (API rate-limit safe)
      const processedScenes: SceneWithMedia[] = [];
      for (let i = 0; i < script.script.length; i++) {
        const scene = script.script[i];
        console.log(`[${i + 1}/${script.script.length}] Processing scene: ${scene.time}`);
        const audioResults = await this.generateAudioForScenes([scene], options.voiceId);
        processedScenes.push({ ...audioResults[0] } as SceneWithMedia);
      }

      // Attach image URLs once all image generations settle
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

      return {
        videoId,
        title:     script.title,
        duration:  script.duration,
        scenes:    processedScenes,
        status:    "completed",
        progress:  100,
        createdAt: new Date(),
        videoPath,
        srtPath,
      };
    } catch (err: any) {
      console.error(`Video generation failed: ${err.message}`);
      throw new Error(`Video generation failed: ${err.message}`);
    }
  }

  async getVideoStatus(videoId: string): Promise<VideoGenerationResult | null> {
    console.log(`Fetching video status: ${videoId}`);
    return null;
  }

  async regenerateSceneMedia(
    _videoId:        string,
    _sceneIndex:     number,
    _regenerateWhat: "audio" | "image" | "both",
  ): Promise<SceneWithMedia> {
    throw new Error("regenerateSceneMedia requires database integration");
  }

  // ─── Audio generation ───────────────────────────────────────────────────────

  private async generateAudioForScenes(
    scenes:   any[],
    voiceId?: string,
  ): Promise<SceneWithMedia[]> {
    const result: SceneWithMedia[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      try {
        console.log(`  [${i + 1}/${scenes.length}] Generating audio for: ${scene.time}`);

        const audioResult = await audioService.textToSpeechEleven(scene.narration, {
          voice_id: voiceId || "JBFqnCBsd6RMkjVDRZzb",
          speed: 1.0,
          pitch: 1.0,
        });

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
        });

        console.log(`    ✓ Audio uploaded: ${audioUrl.substring(0, 50)}...`);
        console.log(`    ℹ️  Raw audio duration: ${audioResult.duration}s`);

        if (i < scenes.length - 1) await this.delay(500);
      } catch (error: any) {
        console.error(`    ✗ Audio generation failed for scene ${i + 1}: ${error.message}`);
        result.push({ ...scene, audioUrl: undefined, audioDuration: undefined });
      }
    }

    return result;
  }

  // ─── SRT generation ─────────────────────────────────────────────────────────

  private async generateSRT(
    videoId: string,
    scenes:  SceneWithMedia[],
  ): Promise<string> {
    const srtPath = path.join(this.outputDir, `${videoId}.srt`);

    let timeOffset = 0;
    const chunks: string[] = [];

    for (const scene of scenes) {
      if (scene.words && scene.words.length > 0) {
        const chunk = audioService.wordsToSRT(scene.words, timeOffset);
        if (chunk.trim()) chunks.push(chunk);
      }
      timeOffset += scene.audioDuration ?? 0;
    }

    const merged = this.reindexSRT(chunks.join("\n\n"));
    await writeFile(srtPath, merged, "utf-8");

    console.log(`SRT saved: ${srtPath}`);
    return srtPath;
  }

  private reindexSRT(srt: string): string {
    let index = 1;
    return srt.replace(/^\d+$/gm, () => String(index++));
  }

  // ─── Image generation (legacy path — kept for compatibility) ────────────────

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

  // ─── Video assembly ─────────────────────────────────────────────────────────

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
      console.log(`  Expected video length: ~${totalDuration.toFixed(1)}s`);

      console.log(`\n🎬 Creating video with FFmpeg...`);
      const outputPath = path.join(options.outputPath ?? this.outputDir, `${videoId}.mp4`);

      await this.createVideoWithFFmpeg(mediaFiles, outputPath, title, srtPath, options);

      console.log(`\n✨ Video created successfully!`);
      await this.cleanupTempFiles(tempVideoDir);

      return outputPath;
    } catch (error: any) {
      console.error(`\n❌ Video assembly failed: ${error.message}`);
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

      // ── Image ──────────────────────────────────────────────────────────────
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
        console.warn(`    ⚠️  No image URL for scene ${i + 1} - skipping`);
      }

      // ── Audio ──────────────────────────────────────────────────────────────
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
        console.warn(`    ⚠️  Skipping scene ${i + 1} - no valid image`);
        continue;
      }

      // ── Duration ───────────────────────────────────────────────────────────
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
          console.log(`    ⚠️  ffprobe failed, using fallback: ${sceneDuration.toFixed(2)}s`);
        }
      } else {
        sceneDuration = MIN_SCENE_DURATION;
        console.log(`    ℹ️  No audio, scene held for ${sceneDuration}s`);
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

    console.log(`\n  ✅ ${mediaFiles.length}/${scenes.length} scenes ready for video assembly`);

    return mediaFiles;
  }

  // ─── ffprobe ─────────────────────────────────────────────────────────────────

  private probeAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
        if (err || !metadata?.format?.duration) resolve(0);
        else resolve(parseFloat(metadata.format.duration) || 0);
      });
    });
  }

  // ─── File download with retry ────────────────────────────────────────────────

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

  // ─── FFmpeg assembler ────────────────────────────────────────────────────────

  private createVideoWithFFmpeg(
    mediaFiles: MediaFile[],
    outputPath: string,
    _title:     string,
    srtPath?:   string,
    options:    VideoGenerationOptions = {},
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const genre = options.genre ?? "cinematic";

      // ── Resolve per-scene effect configs ────────────────────────────────────
      const narrationScenes = mediaFiles.map((m) => ({ narration: m.narration }));
      const autoEffects     = assignSceneEffects(narrationScenes, options.globalTransition);

      const effectConfigs: SceneEffectConfig[] = autoEffects.map((auto, i) => ({
        ...auto,
        ...(options.sceneEffects?.[i] ?? {}),
      }));

      // ── Subtitle filter (built once, applied to final stream) ───────────────
      const subtitleFilter =
        !options.disableSubtitles && srtPath
          ? buildSubtitleFilter(srtPath, options.subtitleStyle)
          : null;

      let command = ffmpeg();

      // ── Single-scene path ───────────────────────────────────────────────────
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

      // ── Multi-scene path ────────────────────────────────────────────────────
      } else {
        const N = mediaFiles.length;

        // Image inputs
        mediaFiles.forEach((m) =>
          command.input(m.image).inputOptions(["-loop", "1", "-t", String(m.duration)]),
        );

        // Audio inputs
        const audioIndices: number[] = [];
        mediaFiles.forEach((m, i) => {
          if (m.audio) { command.input(m.audio); audioIndices.push(i); }
        });

        let filterComplex = "";

        // 1. Per-clip: prescale + zoompan + atmosphere
        for (let i = 0; i < N; i++) {
          const cfg     = effectConfigs[i];
          const sceneVf = buildSceneFilter(cfg.motion, mediaFiles[i].duration, cfg.impact, genre);
          filterComplex += `[${i}:v]${sceneVf}[sv${i}];`;
        }

        // 2. xfade chain — transition comes from SceneEffectConfig
        let cumulativeDuration = 0;
        let prev = "sv0";

        for (let i = 1; i < N; i++) {
          cumulativeDuration += mediaFiles[i - 1].duration;
          const offset     = Math.max(0, cumulativeDuration - FADE_DURATION * i);
          const transition = effectConfigs[i - 1].transition;
          const isLast     = i === N - 1;
          const out        = isLast ? (subtitleFilter ? "outv_raw" : "outv") : `v${i}`;

          // 'hard-cut' → near-zero duration fade (imperceptible cut)
          const xfadeTransition = transition === "hard-cut" ? "fade" : transition;
          const xfadeDuration   = transition === "hard-cut" ? 0.03 : FADE_DURATION;

          filterComplex +=
            `[${prev}][sv${i}]xfade=transition=${xfadeTransition}:duration=${xfadeDuration}:offset=${offset}[${out}];`;

          prev = out;
        }

        // 3. Subtitle on final stream
        if (subtitleFilter) {
          filterComplex += `[outv_raw]${subtitleFilter}[outv];`;
        }

        // 4. Audio concat
        if (audioIndices.length > 0) {
          const labels = audioIndices.map((_, idx) => `[${N + idx}:a]`).join("");
          filterComplex += `${labels}concat=n=${audioIndices.length}:v=0:a=1[outa]`;
        } else {
          filterComplex = filterComplex.replace(/;$/, "");
        }

        command.complexFilter(filterComplex);
        command.outputOptions(["-map", "[outv]"]);
        if (audioIndices.length > 0) {
          command.outputOptions(["-map", "[outa]"]);
          command.outputOptions(["-shortest"]);
        }
      }

      command
        .output(outputPath)
        .outputOptions([
          "-c:v",    "libx264",
          "-preset", "medium",
          "-crf",    "23",
          "-pix_fmt","yuv420p",
          "-c:a",    "aac",
          "-b:a",    "192k",
          "-ar",     "44100",
        ])
        .on("start",    (cmd) => console.log("FFmpeg:", cmd))
        .on("progress", (p)   => { if (p.percent) console.log(`  ${Math.round(p.percent)}%`); })
        .on("end",      ()    => { console.log("  ✓ Done"); resolve(); })
        .on("error",    (err) => { console.error("  ✗ FFmpeg error:", err.message); reject(err); })
        .run();
    });
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

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

  // ─── Utilities ────────────────────────────────────────────────────────────────

  private generateVideoId(): string {
    return `vid_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new VideoService();