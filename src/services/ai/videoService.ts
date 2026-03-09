// services/videoService.ts
import scriptService from "./scriptService";
import audioService from "./aud";
import imageService from "./imageService";
import ffmpeg from "fluent-ffmpeg";
import { WordTiming } from "./aud"; 
import fs from "fs";
import path from "path";
import { promisify } from "util";
import axios from "axios";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);

// ─── Minimum seconds a scene will occupy in the final video ───────────────────
const MIN_SCENE_DURATION = 5; // seconds
const FADE_DURATION = 0.5;    // seconds (xfade overlap)

// ─── Output resolution (vertical / portrait) ──────────────────────────────────
const OUT_W = 1080;
const OUT_H = 1920;

interface VideoGenerationOptions {
  duration?: number;
  genre?: string;
  language?: string;
  imageStyle?: string;
  voiceId?: string;
  outputPath?: string;
}

interface SceneWithMedia {
  time: string;
  scene: string;
  visual: string;
  narration: string;
  imagePrompt: string;
  audioUrl?: string;
  imageUrl?: string;
  audioDuration?: number;
  words?: WordTiming[];
}

interface VideoGenerationResult {
  videoId: string;
  title: string;
  duration: string;
  scenes: SceneWithMedia[];
  status: "processing" | "completed" | "failed";
  progress: number;
  createdAt: Date;
  videoPath?: string;
  videoUrl?: string;
  srtPath?: string;
}

interface MediaFile {
  image: string;
  audio?: string;
  duration: number;
}

class VideoService {
  private tempDir = path.join(process.cwd(), "temp");
  private outputDir = path.join(process.cwd(), "output");

  constructor() {
    this.ensureDirectories();
  }

  // ─── Directory helpers ──────────────────────────────────────────────────────

  private async ensureDirectories() {
    try {
      await mkdir(this.tempDir, { recursive: true });
      await mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error("Error creating directories:", error);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async generateVideos(
    topic: string,
    options: VideoGenerationOptions = {}
  ): Promise<VideoGenerationResult> {
    const videoId = this.generateVideoId();

    try {
      console.log(`starting video gen: ${videoId}`);
      console.log(`Topic: ${topic}`);
      console.log(`Options:`, options);

      console.log("script gen started...");
      const script = await scriptService.generate(
        topic,
        options.imageStyle || "anime",
        {
          duration: options.duration || 60,
          genre: options.genre || "scary",
          language: options.language || "en",
        }
      );

      console.log(`script generated: ${script.script.length} scenes`);

      // scene бүрд audio + image үүсгэнэ.
      // Audio: ElevenLabs зэрэг хүсэлт 3-аас хэтрэхгүй байх тул дараалан боловсруулна.
      // Image: concurrency хязгааргүй тул бүгдийг зэрэг эхлүүлнэ.
      const imagePromises = script.script.map((scene) =>
        imageService.generateSingle(
          {
            time: scene.time,
            scene: scene.scene,
            description: scene.imagePrompt || scene.visual,
          },
          scene.imagePrompt || scene.visual
        )
      );

      const processedScenes: SceneWithMedia[] = [];

      for (let index = 0; index < script.script.length; index++) {
        const scene = script.script[index];
        console.log(
          `[${index + 1}/${script.script.length}] Processing scene: ${scene.time}`
        );

        const audioResults = await this.generateAudioForScenes([scene], options.voiceId);
        processedScenes.push({ ...audioResults[0] } as SceneWithMedia);
      }

      // Attach image URLs once all image generations settle
      const imageUrls = await Promise.allSettled(imagePromises);
      imageUrls.forEach((result, index) => {
        if (result.status === "fulfilled") {
          processedScenes[index].imageUrl = result.value ?? undefined;
        } else {
          console.warn(`  ⚠️  Image failed for scene ${index + 1}:`, result.reason?.message);
        }
      });


      const srtPath =  await this.generateSRT(videoId, processedScenes);

      console.log(
        `All scenes processed: ${processedScenes.filter((s) => s.imageUrl).length}/${script.script.length} with images`
      );

      const videoPath = await this.assembleVideo(
        videoId,
        processedScenes,
        script.title,
        srtPath
      );

      return {
        videoId,
        title: script.title,
        duration: script.duration,
        scenes: processedScenes,
        status: "completed",
        progress: 100,
        createdAt: new Date(),
        videoPath,
        srtPath
      };
    } catch (err: any) {
      console.error(`Video generation failed: ${err.message}`);
      throw new Error(`Video generation failed: ${err.message}`);
    }
  }

  // async generateVideo(
  //   topic: string,
  //   options: VideoGenerationOptions = {}
  // ): Promise<VideoGenerationResult> {
  //   const videoId = this.generateVideoId();

  //   try {
  //     console.log(`\n🎬 Starting video generation: ${videoId}`);
  //     console.log(`Topic: ${topic}`);
  //     console.log(`Options:`, options);

  //     // STEP 1: Generate Script
  //     console.log("\n📝 STEP 1/4: Generating script...");
  //     const script = await scriptService.generate(
  //       topic,
  //       options.imageStyle || "anime",
  //       {
  //         duration: options.duration || 60,
  //         genre: options.genre || "horror",
  //         language: options.language || "mongolian",
  //       }
  //     );
  //     console.log(`✅ Script generated: ${script.script.length} scenes`);

  //     // STEP 2: Generate Audio
  //     console.log("\n🎵 STEP 2/4: Generating audio...");
  //     const scenesWithAudio = await this.generateAudioForScenes(
  //       script.script,
  //       options.voiceId
  //     );
  //     console.log(`✅ Audio generated for ${scenesWithAudio.length} scenes`);

  //     // STEP 3: Generate Images
  //     console.log("\n🖼️  STEP 3/4: Generating images...");
  //     const scenesWithImages = await this.generateImagesForScenes(
  //       scenesWithAudio,
  //       script.backgroundImages
  //     );
  //     console.log(`✅ Images generated for ${scenesWithImages.length} scenes`);

  //     // STEP 4: Assemble Video
  //     console.log("\n🎞️  STEP 4/4: Assembling video...");
  //     const videoPath = await this.assembleVideo(
  //       videoId,
  //       scenesWithImages,
  //       script.title
  //     );
  //     console.log(`✅ Video assembled: ${videoPath}`);

  //     const result: VideoGenerationResult = {
  //       videoId,
  //       title: script.title,
  //       duration: script.duration,
  //       scenes: scenesWithImages,
  //       status: "completed",
  //       progress: 100,
  //       createdAt: new Date(),
  //       videoPath,
  //     };

  //     console.log(`\n✨ Video generation completed: ${videoId}`);
  //     console.log(`📁 Video saved to: ${videoPath}`);

  //     return result;
  //   } catch (error: any) {
  //     console.error(`\n❌ Video generation failed: ${error.message}`);
  //     throw new Error(`Video generation failed: ${error.message}`);
  //   }
  // }

  async getVideoStatus(videoId: string): Promise<VideoGenerationResult | null> {
    console.log(`Fetching video status: ${videoId}`);
    return null;
  }

  async regenerateSceneMedia(
    _videoId: string,
    _sceneIndex: number,
    _regenerateWhat: "audio" | "image" | "both"
  ): Promise<SceneWithMedia> {
    throw new Error("regenerateSceneMedia requires database integration");
  }

  // ─── Audio generation ───────────────────────────────────────────────────────

  private async generateAudioForScenes(
    scenes: any[],
    voiceId?: string
  ): Promise<SceneWithMedia[]> {
    const scenesWithAudio: SceneWithMedia[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      try {
        console.log(
          `  [${i + 1}/${scenes.length}] Generating audio for: ${scene.time}`
        );

        const audioResult = await audioService.textToSpeechEleven(scene.narration, {
          voice_id: voiceId || "JBFqnCBsd6RMkjVDRZzb",
          speed: 1.0,
          pitch: 1.0,
        });

        const filename = `audio_${this.generateVideoId()}_scene${i}`;
        const audioUrl = await audioService.uploadToCloudinary(
          audioResult.audioBuffer,
          filename
        );

        scenesWithAudio.push({
          ...scene,
          audioUrl,
          audioDuration: audioResult.duration,
          words: audioResult.words
        });

        console.log(`    ✓ Audio uploaded: ${audioUrl.substring(0, 50)}...`);
        console.log(`    ℹ️  Raw audio duration: ${audioResult.duration}s`);

        if (i < scenes.length - 1) await this.delay(500);
      } catch (error: any) {
        console.error(
          `    ✗ Audio generation failed for scene ${i + 1}: ${error.message}`
        );
        scenesWithAudio.push({
          ...scene,
          audioUrl: undefined,
          audioDuration: undefined,
        });
      }
    }

    return scenesWithAudio;
  }

  private async generateSRT(videoId: string, scenes: SceneWithMedia[]): Promise<string> {
    const srtPath = path.join(this.outputDir, `${videoId}.srt`);

    let timeOffset = 0;
    const chunks: string[] = [];

    for (const scene of scenes) {
      if (scene.words && scene.words.length > 0) {
        const chunk = audioService.wordsToSRT(scene.words, timeOffset);
        if (chunk.trim()) chunks.push(chunk);
      }
      
      // MIN_SCENE_DURATION-ийг хасаж, зөвхөн аудионы бодит уртыг нэмнэ.
      // Ингэснээр дуу болон текст яг цав таарна.
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
  // ─── Image generation ───────────────────────────────────────────────────────

  private async generateImagesForScenes(
    scenes: SceneWithMedia[],
    backgroundImages: any[]
  ): Promise<SceneWithMedia[]> {
    console.log(
      `\n🖼️ Generating images using imageService.generateFromScript()...`
    );

    try {
      const scriptScenes = scenes.map((scene) => ({
        time: scene.time,
        scene: scene.scene,
        description: scene.imagePrompt || scene.visual,
      }));

      const generatedImages = await imageService.generateFromScript(
        scriptScenes,
        backgroundImages
      );

      const scenesWithImages: SceneWithMedia[] = scenes.map((scene, index) => {
        const generatedImage = generatedImages.find(
          (img) => img.sceneTime === scene.time
        );

        let imageUrl = generatedImage?.imageUrl;

        if (imageUrl && !imageUrl.startsWith("http")) {
          console.log(
            `  ⚠️  Scene ${index + 1}: Got local path instead of URL: ${imageUrl}`
          );
          if (!path.isAbsolute(imageUrl)) {
            imageUrl = path.resolve(imageUrl);
          }
          console.log(`  ℹ️  Using absolute path: ${imageUrl}`);
        }

        return { ...scene, imageUrl: imageUrl || undefined };
      });

      const successCount = scenesWithImages.filter((s) => s.imageUrl).length;
      console.log(`✅ Images: ${successCount}/${scenes.length} successful`);

      return await this.uploadLocalImagesToCloudinary(scenesWithImages);
    } catch (error: any) {
      console.error(`❌ Image generation error:`, error.message);
      return scenes.map((scene) => ({ ...scene, imageUrl: undefined }));
    }
  }

  private async uploadLocalImagesToCloudinary(
    scenes: SceneWithMedia[]
  ): Promise<SceneWithMedia[]> {
    const cloudinary = require("cloudinary").v2;

    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      console.warn("⚠️  Cloudinary not configured - keeping local paths");
      return scenes;
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const updatedScenes: SceneWithMedia[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      if (!scene.imageUrl || scene.imageUrl.startsWith("http")) {
        updatedScenes.push(scene);
        continue;
      }

      try {
        console.log(
          `  [${i + 1}/${scenes.length}] Uploading local image to Cloudinary...`
        );
        const uploadResult = await cloudinary.uploader.upload(scene.imageUrl, {
          folder: "ai-generated-images",
          resource_type: "image",
        });
        console.log(
          `    ✓ Uploaded: ${uploadResult.secure_url.substring(0, 50)}...`
        );
        updatedScenes.push({ ...scene, imageUrl: uploadResult.secure_url });
      } catch (uploadError: any) {
        console.error(`    ✗ Upload failed: ${uploadError.message}`);
        console.log(`    ℹ️  Keeping local path: ${scene.imageUrl}`);
        updatedScenes.push(scene);
      }
    }

    return updatedScenes;
  }

  // ─── Video assembly ─────────────────────────────────────────────────────────

  private async assembleVideo(
    videoId: string,
    scenes: SceneWithMedia[],
    title: string,
    srtPath?: string
  ): Promise<string> {
    const tempVideoDir = path.join(this.tempDir, videoId);
    await mkdir(tempVideoDir, { recursive: true });

    try {
      console.log(`\n🔧 Preparing media files...`);
      const mediaFiles = await this.downloadSceneMedia(scenes, tempVideoDir);

      console.log("\n📊 Scene duration summary:");
      mediaFiles.forEach((m, i) => {
        console.log(
          `  Scene ${i + 1}: ${m.duration}s  image=${path.basename(m.image)}  audio=${
            m.audio ? path.basename(m.audio) : "none"
          }`
        );
      });
      const totalDuration =
        mediaFiles.reduce((s, m) => s + m.duration, 0) -
        FADE_DURATION * (mediaFiles.length - 1);
      console.log(`  Expected video length: ~${totalDuration.toFixed(1)}s`);

      console.log(`\n🎬 Creating video with FFmpeg...`);
      const outputPath = path.join(this.outputDir, `${videoId}.mp4`);
      await this.createVideoWithFFmpeg(mediaFiles, outputPath, title, srtPath);

      console.log(`\n✨ Video created successfully!`);
      await this.cleanupTempFiles(tempVideoDir);

      return outputPath;
    } catch (error: any) {
      console.error(`\n❌ Video assembly failed: ${error.message}`);
      throw error;
    }
  }

  private async downloadSceneMedia(
    scenes: SceneWithMedia[],
    tempDir: string
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
          } else {
            if (fs.existsSync(scene.imageUrl)) {
              imagePath = scene.imageUrl;
              console.log(`    ✓ Using local image: ${imagePath}`);
            } else {
              console.error(`    ✗ Local file not found: ${scene.imageUrl}`);
            }
          }
        } catch (error: any) {
          console.error(`    ✗ Image preparation failed: ${error.message}`);
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
        } catch (error: any) {
          console.error(`    ✗ Audio download failed: ${error.message}`);
          audioPath = undefined;
        }
      }

      if (imagePath) {
        let sceneDuration: number;

        if (audioPath) {
          // Ground-truth duration: probe the actual downloaded audio file.
          // This is always more accurate than the API-reported duration.
          const probed = await this.probeAudioDuration(audioPath);
          if (probed > 0) {
            // Add a small tail so the image doesn't cut off on the last syllable
            sceneDuration = probed + 0.3;
            console.log(`    ✓ Probed duration: ${probed.toFixed(2)}s (+0.3s tail → ${sceneDuration.toFixed(2)}s)`);
          } else {
            // ffprobe failed — fall back to API value, clamp to minimum
            const fallback = scene.audioDuration ?? 0;
            sceneDuration = Math.max(fallback, MIN_SCENE_DURATION);
            console.log(`    ⚠️  ffprobe failed, using fallback: ${sceneDuration.toFixed(2)}s`);
          }
        } else {
          // No audio for this scene — hold image for the minimum duration
          sceneDuration = MIN_SCENE_DURATION;
          console.log(`    ℹ️  No audio, scene held for ${sceneDuration}s`);
        }

        mediaFiles.push({ image: imagePath, audio: audioPath, duration: sceneDuration });
      } else {
        console.warn(`    ⚠️  Skipping scene ${i + 1} - no valid image`);
      }
    }

    if (mediaFiles.length === 0) {
      throw new Error("No valid scenes with images found. Cannot create video.");
    }

    console.log(
      `\n  ✅ ${mediaFiles.length}/${scenes.length} scenes ready for video assembly`
    );

    return mediaFiles;
  }

  // ─── ffprobe: get real audio duration from a local file ─────────────────────
  // fluent-ffmpeg bundles ffprobe, so no extra dependency needed.
  private probeAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
        if (err || !metadata?.format?.duration) {
          resolve(0);
        } else {
          resolve(parseFloat(metadata.format.duration) || 0);
        }
      });
    });
  }

  private async downloadFile(url: string, outputPath: string): Promise<void> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios({
          url,
          method: "GET",
          responseType: "arraybuffer",
          timeout: 15000, // 15s timeout
        });
        await writeFile(outputPath, response.data);
        return; // success
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`    ⚠️  Download attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
        if (attempt < maxRetries) await this.delay(1500 * attempt);
      }
    }

    throw new Error(`Download failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  // ─── FFmpeg ─────────────────────────────────────────────────────────────────

  private createVideoWithFFmpeg(
    mediaFiles: MediaFile[],
    outputPath: string,
    _title: string,
    srtPath?: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const scaleFilter =
        `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,` +
        `crop=${OUT_W}:${OUT_H},setsar=1,fps=30`;

      // ── Subtitle filter applied to the FINAL concatenated stream only ────────
      // Applying it per-clip would show subtitles at wrong timestamps (each clip
      // restarts at 0), so we attach it to [outv] after the xfade chain.
      // SRT path: on Windows escape colons; on Linux/Mac no change needed.
      const srtEscaped = srtPath
        ? srtPath.replace(/\\/g, "/").replace(/:/g, "\\:")
        : null;
      // Subtitle style — 1080×1920 portrait, word-by-word, голд (middle-center)
      // Alignment=5  → SSA numpad: дунд-голд (middle-center)
      // FontSize=22   → 1080p portrait-д тохирсон хэмжээ
      // PrimaryColour  &H00FFFF00 = yellow  (AABBGGRR little-endian hex)
      // OutlineColour  &H00000000 = black
      // ShadowColour   &H80000000 = half-transparent black shadow
      // Outline=3, Shadow=1 → тод харагдах outline + shadow
      const subtitleFilterStr = srtEscaped
        ? `subtitles='${srtEscaped}':` +
          `force_style='FontName=Arial,FontSize=16,Bold=1,` +
          `PrimaryColour=&H00FFFF00,OutlineColour=&H00000000,` +
          `ShadowColour=&H80000000,Outline=3,Shadow=1,` +
          `Alignment=2,MarginV=150'`
        : null;

      // Per-clip filter: scale only (no subtitles)
      const fullFilter = scaleFilter;

      let command = ffmpeg();

      if (mediaFiles.length === 1) {
        command
          .input(mediaFiles[0].image)
          .inputOptions(["-loop", "1", "-t", mediaFiles[0].duration.toString()]);

        if (mediaFiles[0].audio) command.input(mediaFiles[0].audio);

        // For single scene, apply subtitle directly via -vf (correct global time)
        const singleVf = subtitleFilterStr
          ? `${fullFilter},${subtitleFilterStr}`
          : fullFilter;
        command.outputOptions(["-map", "0:v", "-vf", singleVf]);
        if (mediaFiles[0].audio) command.outputOptions(["-map", "1:a"]);

      } else {
        mediaFiles.forEach((m) => {
          command.input(m.image).inputOptions(["-loop", "1", "-t", m.duration.toString()]);
        });

        const audioSceneIndices: number[] = [];
        mediaFiles.forEach((m, i) => {
          if (m.audio) { command.input(m.audio); audioSceneIndices.push(i); }
        });

        const N = mediaFiles.length;
        let filterComplex = "";

        // Per-clip: scale only
        for (let i = 0; i < N; i++) {
          filterComplex += `[${i}:v]${fullFilter}[sv${i}];`;
        }

        let cumulativeDuration = 0;
        let prev = "sv0";

        for (let i = 1; i < N; i++) {
          cumulativeDuration += mediaFiles[i - 1].duration;
          const offset = Math.max(0, cumulativeDuration - FADE_DURATION * i);
          // Last xfade outputs [outv_raw] so we can attach the subtitle filter after
          const out = i === N - 1 ? (subtitleFilterStr ? "outv_raw" : "outv") : `v${i}`;
          filterComplex += `[${prev}][sv${i}]xfade=transition=fade:duration=${FADE_DURATION}:offset=${offset}[${out}];`;
          prev = out;
        }

        // Apply subtitle filter to final stream (correct global timestamps)
        if (subtitleFilterStr) {
          filterComplex += `[outv_raw]${subtitleFilterStr}[outv];`;
        }

        if (audioSceneIndices.length > 0) {
          const labels = audioSceneIndices.map((_, idx) => `[${N + idx}:a]`).join("");
          filterComplex += `${labels}concat=n=${audioSceneIndices.length}:v=0:a=1[outa]`;
        } else {
          filterComplex = filterComplex.replace(/;$/, "");
        }

        command.complexFilter(filterComplex);
        command.outputOptions(["-map", "[outv]"]);
        if (audioSceneIndices.length > 0) command.outputOptions(["-map", "[outa]"]);
      }

      command
        .output(outputPath)
        .outputOptions([
          "-c:v", "libx264",
          "-preset", "medium",
          "-crf", "23",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "192k",
          "-ar", "44100",
        ])
        .on("start", (cmd) => console.log("FFmpeg:", cmd))
        .on("progress", (p) => { if (p.percent) console.log(`  ${Math.round(p.percent)}%`); })
        .on("end", () => { console.log("  ✓ Done"); resolve(); })
        .on("error", (err) => { console.error("  ✗ FFmpeg error:", err.message); reject(err); })
        .run();
    });
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  private async cleanupTempFiles(tempDir: string): Promise<void> {
    try {
      const files = await readdir(tempDir);
      for (const file of files) {
        await unlink(path.join(tempDir, file));
      }
      await fs.promises.rmdir(tempDir);
      console.log(`  ✓ Cleaned up temporary files`);
    } catch (error) {
      console.error("  ⚠️  Cleanup failed:", error);
    }
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  private generateVideoId(): string {
    return `vid_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new VideoService();