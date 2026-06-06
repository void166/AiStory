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
import type { ProgressEvent } from "../progressEmitter";

// ─── Cancellation primitives ────────────────────────────────────────────────
export class CancellationError extends Error {
  public partial: any;
  constructor(message: string, partial: any) {
    super(message);
    this.name = 'CancellationError';
    this.partial = partial;
  }
}

function throwIfAborted(signal: AbortSignal | undefined, partial: any): void {
  if (signal?.aborted) {
    throw new CancellationError('Generation cancelled by user', partial);
  }
}





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
  onProgress?: (event: ProgressEvent) => void;
  /**
   * Abort signal that the caller (controller) uses to cancel generation.
   * When aborted, generateVideos throws a CancellationError whose `partial`
   * field carries whatever scenes/state were produced before the cancel.
   */
  signal?: AbortSignal;
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
  /**
   * Per-scene Cloudinary CDN URL promises. The caller (controller) awaits
   * these in the background to patch Scene.imageUrl from local path → CDN URL
   * once each async upload finishes.
   */
  sceneCloudUrlPromises?: Promise<string>[];
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

    const emit = options.onProgress ?? (() => {});

    try {
      console.log(`Starting video gen: ${videoId}`);
      console.log(`Topic: ${topic}`);
      console.log(`Options:`, options);

      emit({ step: 'writing_script', message: 'Script бичиж байна...' });
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
      emit({ step: 'writing_script', message: `Script бэлэн: ${script.script.length} scene`, percent: 15 });

      // Thumbnail generation is deferred — runs AFTER the video is saved
      // (see videoController.generateVideos). We still surface the concept so
      // the controller knows what prompt to use for the background job.
      const rawThumbnail = script.thumbnailConcept?.[0];
      const thumbnail: GeneratedThumbnail | undefined = rawThumbnail
        ? {
            focus:       rawThumbnail.focus,
            emotion:     rawThumbnail.emotion,
            visualHook:  rawThumbnail.visualHook,
            textOverlay: rawThumbnail.textOverlay,
            thumbnailUrl: '',          // filled in later by background job
            generatedAt: new Date(),
          }
        : undefined;

      // Cancellation checkpoint #1 — after script + thumbnail concept
      throwIfAborted(options.signal, {
        scenes: script.script.map((s: any) => ({
          time: s.time, scene: s.scene, narration: s.narration,
          imagePrompt: s.imagePrompt || s.visual,
        })),
        duration: script.duration,
        progress: 15,
        thumbnail,
      });

      // ── Start images in parallel ─────────────────────────────────────────
      // generateSingle returns a LOCAL path immediately so FFmpeg can start
      // assembling without waiting on Cloudinary. We also collect a per-scene
      // promise that resolves to the Cloudinary CDN URL once the async upload
      // completes — those are returned alongside the result so the controller
      // can patch each Scene.imageUrl in the background, replacing the local
      // path with the CDN URL once it lands.
      const sceneCloudResolvers: Array<{ resolve: (url: string) => void; reject: (err: Error) => void; promise: Promise<string> }> =
        script.script.map(() => {
          let resolve!: (url: string) => void;
          let reject!: (err: Error) => void;
          const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
          return { resolve, reject, promise };
        });

      const imagePromises = script.script.map((scene, i) =>
        imageService.generateSingle(
          { time: scene.time, scene: scene.scene, description: scene.imagePrompt || scene.visual },
          scene.imagePrompt || scene.visual,
          undefined,
          (cloudUrl) => sceneCloudResolvers[i].resolve(cloudUrl),
        ).catch(err => {
          // If image generation itself fails, also fail the cloud-URL promise
          sceneCloudResolvers[i].reject(err instanceof Error ? err : new Error(String(err)));
          throw err;
        }),
      );

      // Expose the cloud-URL promises so the caller can update DB rows later
      const sceneCloudUrlPromises = sceneCloudResolvers.map(r => r.promise);

      const totalScenes = script.script.length;
      const processedScenes: SceneWithMedia[] = [];
      for (let i = 0; i < totalScenes; i++) {
        const scene = script.script[i];
        console.log(`[${i + 1}/${totalScenes}] Processing scene: ${scene.time}`);
        emit({
          step: 'generating_audio',
          message: `Дуу хоолой: ${i + 1}/${totalScenes} scene`,
          sceneIndex: i,
          totalScenes,
          percent: 20 + Math.round((i / totalScenes) * 30),
        });
        const audioResults = await this.generateAudioForScenes(
          [scene],
          options.voiceId,
          options.ttsProvider ?? 'gemini',
          { genre: options.genre, language: options.language },
        );
        processedScenes.push({ ...audioResults[0] } as SceneWithMedia);

        // Cancellation checkpoint per scene — partial includes whatever audio
        // has been produced so far so the draft retains those URLs
        throwIfAborted(options.signal, {
          scenes: processedScenes,
          duration: script.duration,
          progress: 20 + Math.round(((i + 1) / totalScenes) * 30),
          thumbnail,
        });
      }

      emit({ step: 'generating_images', message: 'Processing Images...', percent: 50 });
      const imageResults = await Promise.allSettled(imagePromises);
      let imageSuccessCount = 0;
      imageResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          processedScenes[index].imageUrl = result.value ?? undefined;
          imageSuccessCount++;
        } else {
          console.warn(
            `  ⚠️  Image failed for scene ${index + 1}:`,
            result.reason?.message,
          );
        }
      });
      emit({
        step: 'generating_images',
        message: `Images Ready!: ${imageSuccessCount}/${totalScenes}`,
        percent: 65,
      });

      emit({ step: 'rendering_video', message: 'Creating Substitles...', percent: 68 });
      const srtPath = options.disableSubtitles
        ? undefined
        : await this.generateSRT(videoId, processedScenes);

      console.log(
        `All scenes processed: ${processedScenes.filter((s) => s.imageUrl).length}/${script.script.length} with images`,
      );

      // Last cancellation checkpoint — after audio + images, before FFmpeg
      // (FFmpeg itself isn't trivially cancellable, so this is our last chance)
      throwIfAborted(options.signal, {
        scenes: processedScenes,
        duration: script.duration,
        progress: 65,
        thumbnail,
      });

      emit({ step: 'rendering_video', message: 'Assembling Video...', percent: 70 });
      const videoPath = await this.assembleVideo(
        videoId,
        processedScenes,
        script.title,
        srtPath,
        { ...options, onProgress: emit },
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

      emit({ step: 'rendering_video', message: 'Into the cloudinary...', percent: 90 });

      const cloudVideoUrl = await this.uploadVideoToCloudinary(videoPath, videoId);
      const videoUrl = cloudVideoUrl ?? `/output/${videoId}.mp4`;

      emit({ step: 'complete', message: 'Video created Succesfully!', percent: 100 });

      return {
        videoId,
        title:     script.title,
        duration:  script.duration,
        scenes:    processedScenes,
        status:    "completed",
        progress:  100,
        createdAt: new Date(),
        videoPath,
        videoUrl,
        srtPath,
        thumbnail,
        // Promises that resolve (per scene) once each image's Cloudinary upload
        // finishes. The controller awaits these in the background to patch the
        // Scene.imageUrl column from the local path to the CDN URL.
        sceneCloudUrlPromises,
      };
    } catch (err: any) {
      emit({ step: 'error', message: err.message || 'Видео үүсгэхэд алдаа гарлаа' });
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
    onCloudinaryDone?: (cloudUrl: string) => void,
  ): Promise<{ videoPath: string; videoUrl: string }> {
    console.log(`\n🔁 Re-assembling video: ${videoId}`);

    // ── SRT: regenerate from current narration text + audioDuration ──────────
    // We intentionally ignore scene.words here because they may be stale
    // (generated for a previous narration). Using narration+audioDuration always
    // reflects the current text, even for videos saved before the words-update fix.
    let srtToUse: string | undefined;
    if (!options.disableSubtitles) {
      console.log('  📝 Regenerating SRT from narration text...');
      const existingSrt = path.join(this.outputDir, `${videoId}.srt`);
      if (fs.existsSync(existingSrt)) {
        try { fs.unlinkSync(existingSrt); } catch { /* ignore */ }
      }
      // Strip words so generateSRT falls back to narrationToSRTBlock per scene
      const scenesForSRT = scenes.map(s => ({ ...s, words: [] as any[] }));
      srtToUse = await this.generateSRT(videoId, scenesForSRT);
    }

    console.log(`  Scenes: ${scenes.length}, SRT: ${srtToUse ? 'yes' : 'no'}`);

    const videoPath = await this.assembleVideo(videoId, scenes, title, srtToUse, options);

    // Return the local URL immediately so the user sees the video right away.
    // Cloudinary upload runs in the background; when finished we invoke the
    // callback so the caller can swap the DB URL to the CDN one.
    const localUrl = `/output/${videoId}.mp4`;

    this.uploadVideoToCloudinary(videoPath, videoId)
      .then(cloudUrl => {
        if (cloudUrl) {
          console.log(`☁️  Reassemble background upload done: ${cloudUrl.substring(0, 60)}...`);
          onCloudinaryDone?.(cloudUrl);
        }
      })
      .catch(err => {
        console.warn(`⚠️  Reassemble Cloudinary upload failed: ${err.message}`);
      });

    return { videoPath, videoUrl: localUrl };
  }

  /**
   * Background thumbnail generator. Fire-and-forget: returns immediately so
   * the API response isn't blocked. Generates the thumbnail, waits for its
   * Cloudinary URL, then updates Video.thumbnail_url.
   */
  generateThumbnailForVideoInBackground(
    videoId: string,
    concept: { focus: string; emotion: string; visualHook: string; textOverlay?: string },
    style: string = 'cinematic',
  ): void {
    (async () => {
      try {
        console.log(`🖼️  [bg] Generating thumbnail for video ${videoId}...`);
        const cdnUrl = await imageService.generateThumbnailCloudUrl(concept as any, style);

        await Video.update(
          { thumbnail_url:  cdnUrl,
            Tfocus:         concept.focus       ?? null,
            Temotion:       concept.emotion     ?? null,
            ToverLay:       concept.textOverlay ?? null,
            TvisualHook:    concept.visualHook  ?? null,
          },
          { where: { id: videoId } },
        );
        console.log(`✅ [bg] thumbnail_url saved for video ${videoId}`);
      } catch (err: any) {
        console.warn(`⚠️  [bg] Thumbnail generation failed for ${videoId}: ${err.message}`);
      }
    })();
  }


async reGenImage(
  id: string,
  imagePrompt: string,
): Promise<{ imageUrl: string }> {
  const scene = await Scene.findOne({ where: { id } });
  if (!scene) throw new Error(`Scene ${id} not found`);

  // Persist the prompt now (it's independent of the upload race below)
  await Scene.update({ imagePrompt }, { where: { id } });

  // Track whether Cloudinary has already reported back so we don't
  // race-overwrite the CDN URL with the local path.
  let cloudLanded = false;

  const newImageUrl = await imageService.generateSingle(
    { time: scene.time, scene: scene.scene, description: imagePrompt },
    imagePrompt,
    undefined,
    async (cloudUrl) => {
      cloudLanded = true;
      try {
        await Scene.update({ imageUrl: cloudUrl }, { where: { id } });
        console.log(`☁️  Scene ${id} imageUrl → CDN: ${cloudUrl.substring(0, 60)}...`);
      } catch (err: any) {
        console.warn(`⚠️  Could not update scene ${id} with CDN URL: ${err.message}`);
      }
    },
  );

  // Only write the LOCAL path if the cloud URL hasn't already landed.
  // Otherwise we'd overwrite the CDN URL just written by the callback.
  if (!cloudLanded) {
    const fresh = await Scene.findOne({ where: { id }, attributes: ['imageUrl'] });
    if (!fresh?.imageUrl?.startsWith('http')) {
      await Scene.update({ imageUrl: newImageUrl }, { where: { id } });
    }
  }

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

  // Pull genre/language from the parent Video so Gemini TTS can pick the
  // right voice + delivery style. Lookup is best-effort — if it fails we
  // just fall back to neutral defaults inside callTTS.
  let ttsContext: { genre?: string; language?: string } = {};
  try {
    const parentVideo = await Video.findByPk(scene.videoId, {
      attributes: ['genre', 'language'],
    });
    if (parentVideo) {
      ttsContext = { genre: parentVideo.genre, language: parentVideo.language };
    }
  } catch (e: any) {
    console.warn(`  ⚠️  Could not load video for TTS context: ${e.message}`);
  }

  const audioResult = await this.callTTS(provider, newText, scene.voiceId ?? undefined, ttsContext);

  const filename = `audio_${this.generateVideoId()}_scene${scene.sceneIndex}_regen`;
  const newAudioUrl = await audioService.uploadToCloudinary(audioResult.audioBuffer, filename);

  scene.narration     = newText;
  scene.audioUrl      = newAudioUrl;
  scene.audioDuration = audioResult.duration ?? scene.audioDuration;
  // Save new word timings so SRT regeneration uses the updated narration
  scene.words = audioResult.words ? JSON.stringify(audioResult.words) : null;
  await scene.save();

  console.log(`  ✓ Narration + audio + word timings updated for scene ${id}`);
  return { audioUrl: newAudioUrl, duration: audioResult.duration ?? 0 };
}



  async regenerateSceneMedia(
    videoId:         string,
    sceneIndex:      number,
    regenerateWhat:  "audio" | "image" | "both",
    sceneData?:      { imagePrompt?: string; narration?: string; time?: string; scene?: string },
  ): Promise<Partial<SceneWithMedia>> {
    const result: Partial<SceneWithMedia> = {};

    // Pull the saved Scene (if any) so we can re-use its ttsProvider/voiceId.
    // Newly-added scenes from the UI may not exist in the DB yet — that's OK,
    // we'll fall back to sane defaults and skip DB writes.
    const dbScene = await Scene.findOne({ where: { videoId, sceneIndex } });

    // ── IMAGE ─────────────────────────────────────────────────────────────
    if ((regenerateWhat === "image" || regenerateWhat === "both") && sceneData?.imagePrompt) {
      console.log(`\n🎨 Regenerating image for scene ${sceneIndex}…`);
      const newImageUrl = await imageService.generateSingle(
        {
          time:        sceneData.time  ?? dbScene?.time  ?? "",
          scene:       sceneData.scene ?? dbScene?.scene ?? "",
          description: sceneData.imagePrompt ?? "",
        },
        sceneData.imagePrompt,
      );
      result.imageUrl = newImageUrl;
      console.log(`  ✓ New image: ${newImageUrl.substring(0, 60)}...`);

      if (dbScene) {
        dbScene.imageUrl    = newImageUrl;
        dbScene.imagePrompt = sceneData.imagePrompt ?? dbScene.imagePrompt;
        try { await dbScene.save(); } catch (e: any) {
          console.warn(`  ⚠️  Could not persist new image to DB: ${e.message}`);
        }
      }
    }

    // ── AUDIO ─────────────────────────────────────────────────────────────
    if (regenerateWhat === "audio" || regenerateWhat === "both") {
      const narration = (sceneData?.narration ?? dbScene?.narration ?? "").trim();
      if (!narration) {
        throw new Error(
          `Cannot regenerate audio — narration is empty for scene ${sceneIndex}`,
        );
      }

      // Prefer the scene's stored voice; if missing (e.g. newly-added scene),
      // use the video's defaults; finally fall back to gemini/no-voice.
      let provider: "elevenlabs" | "gemini" | "chimege" =
        (dbScene?.ttsProvider as any) || "gemini";
      let voiceId: string | undefined = dbScene?.voiceId ?? undefined;

      if (!dbScene) {
        // Inherit from sibling scenes of the same video (most consistent UX).
        const sibling = await Scene.findOne({ where: { videoId } });
        if (sibling) {
          provider = (sibling.ttsProvider as any) || provider;
          voiceId  = sibling.voiceId ?? voiceId;
        }
      }

      console.log(
        `\n🎙️  Regenerating audio for scene ${sceneIndex} with [${provider}]…`,
      );

      // Best-effort lookup of parent Video to get genre/language for Gemini TTS.
      let ttsContext: { genre?: string; language?: string } = {};
      try {
        const parentVideo = await Video.findByPk(videoId, {
          attributes: ['genre', 'language'],
        });
        if (parentVideo) {
          ttsContext = { genre: parentVideo.genre, language: parentVideo.language };
        }
      } catch (e: any) {
        console.warn(`  ⚠️  Could not load video for TTS context: ${e.message}`);
      }

      const audioResult = await this.callTTS(provider, narration, voiceId, ttsContext);

      const filename = `audio_${this.generateVideoId()}_scene${sceneIndex}_regen`;
      const newAudioUrl = await audioService.uploadToCloudinary(
        audioResult.audioBuffer,
        filename,
      );

      result.audioUrl      = newAudioUrl;
      result.audioDuration = audioResult.duration;
      result.words         = audioResult.words;

      if (dbScene) {
        dbScene.narration     = narration;
        dbScene.audioUrl      = newAudioUrl;
        dbScene.audioDuration = audioResult.duration ?? dbScene.audioDuration;
        dbScene.words         = audioResult.words ? JSON.stringify(audioResult.words) : null;
        try { await dbScene.save(); } catch (e: any) {
          console.warn(`  ⚠️  Could not persist new audio to DB: ${e.message}`);
        }
      }

      console.log(`  ✓ New audio: ${newAudioUrl.substring(0, 60)}...  (${audioResult.duration?.toFixed?.(2)}s)`);
    }

    return result;
  }



  private async generateAudioForScenes(
    scenes: any[],
    voiceId?: string,
    ttsProvider: 'elevenlabs' | 'gemini' | 'chimege' = 'elevenlabs',
    // Genre/language hand off — Gemini TTS uses these to pick voice +
    // delivery style. Other providers ignore them.
    context?: { genre?: string; language?: string },
  ): Promise<SceneWithMedia[]> {
    const result: SceneWithMedia[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      try {
        console.log(`  [${i + 1}/${scenes.length}] Generating audio for: ${scene.time}`);

        let audioResult = await this.callTTS(ttsProvider, scene.narration, voiceId, context);
        

  
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
    voiceId?: string,
    // Optional context — used by Gemini TTS to pick voice + delivery style.
    // Falls back to safe defaults if not provided (back-compat with old callers).
    context?: { genre?: string; language?: string }
  ){
    // Normalise raw `language` string from DB ("en"/"english"/"mn"/"mongolian"…)
    // into the strict union Gemini TTS expects.
    const normLang: 'mongolian' | 'english' = (() => {
      const l = (context?.language ?? '').toLowerCase();
      if (l.startsWith('mn') || l.startsWith('mon')) return 'mongolian';
      return 'english';
    })();

    switch (provider){
      case 'elevenlabs':
        return audioService.textToSpeechEleven(narration, {
          voice_id: voiceId || 'JBFqnCBsd6RMkjVDRZzb',
          speed: 1.0, pitch: 1.0
        });
        case 'gemini':
          // Pass through `voice_name` only when caller explicitly set one;
          // otherwise let aud.ts pick a genre-appropriate default voice.
          return audioService.textToSpeechGemini(narration,{
            ...(voiceId ? { voice_name: voiceId } : {}),
            genre: context?.genre,
            language: normLang,
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
  
  // Narration-г жижиг chunk-уудад хуваагаад duration-г тэгш хуваарилна.
  // Нэг chunk = 4 үг (subtitle стандарт), харагдах хугацаа = duration / chunkCount.
  private narrationToSRTBlock(
    narration: string,
    startOffset: number,
    duration: number,
  ): string {
    const WORDS_PER_CHUNK = 1;
    const words = narration.trim().split(/\s+/).filter(Boolean);

    if (words.length === 0 || duration <= 0) return '';

    // 4 үгийн chunk-уудад хуваана
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
      chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
    }

    // Нэг chunk-д ногдох хугацаа
    const chunkDur = duration / chunks.length;

    const blocks: string[] = [];
    chunks.forEach((chunk, idx) => {
      const s = this.secondsToSRTTime(startOffset + idx * chunkDur);
      const e = this.secondsToSRTTime(startOffset + (idx + 1) * chunkDur);
      blocks.push(`1\n${s} --> ${e}\n${chunk}`);
    });

    return blocks.join('\n\n');
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



  // ─── Upload final MP4 to Cloudinary ─────────────────────────────────────────
  private async uploadVideoToCloudinary(
    localPath: string,
    videoId:   string,
  ): Promise<string | null> {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDNAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY    || process.env.CLOUD_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.CLOUD_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      console.warn('⚠️  Cloudinary not configured — video kept at local path');
      return null;
    }

    if (!fs.existsSync(localPath)) {
      console.warn(`⚠️  Video file not found for Cloudinary upload: ${localPath}`);
      return null;
    }

    const cloudinary = require('cloudinary').v2;
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

    try {
      console.log(`☁️  Uploading video to Cloudinary (this may take a while)…`);
      const result = await cloudinary.uploader.upload(localPath, {
        resource_type: 'video',
        folder:        'ai-generated-videos',
        public_id:     videoId,
        overwrite:     true,
      });
      console.log(`✅ Video uploaded: ${result.secure_url.substring(0, 70)}…`);

      // NOTE: keep the local copy. /output/<id>.mp4 is served back to the
      // frontend immediately after assembly (see reAssembleVideo). Deleting it
      // would 404 any client that grabbed the local URL before the CDN URL
      // replacement lands. A separate cleanup job can prune older files.

      return result.secure_url as string;
    } catch (err: any) {
      console.warn(`⚠️  Cloudinary video upload failed: ${err.message} — keeping local`);
      return null;
    }
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
      } else if (options.bgmPath && options.bgmPath.startsWith("http")) {
        // Custom BGM uploaded by user → download to temp, then use local path
        try {
          const bgmLocal = path.join(tempVideoDir, "custom_bgm.mp3");
          await this.downloadFile(options.bgmPath, bgmLocal);
          console.log(`  ✓ Custom BGM downloaded → ${bgmLocal}`);
          options.bgmPath = bgmLocal;
        } catch (err: any) {
          console.warn(`  ⚠️  Custom BGM download failed: ${err.message}`);
          options.bgmPath = undefined;
        }
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

  /**
   * Prepare image + audio for every scene, in PARALLEL, with local-file cache.
   *  - All downloads (images + audios) launched at once with Promise.all
   *  - Already-downloaded files are reused (skipped) so repeated re-renders
   *    that change only one scene don't re-fetch the others.
   *  - All ffprobe calls run in parallel after downloads finish.
   */
  private async downloadSceneMedia(
    scenes:  SceneWithMedia[],
    tempDir: string,
  ): Promise<MediaFile[]> {
    console.log(`  ⚡ Preparing media for ${scenes.length} scenes in parallel...`);
    const t0 = Date.now();

    // Helper: skip download if cached file exists and is non-empty
    const ensureCachedDownload = async (url: string, dest: string): Promise<string> => {
      try {
        const st = fs.statSync(dest);
        if (st.size > 0) {
          console.log(`    ↺ cache hit: ${path.basename(dest)}`);
          return dest;
        }
      } catch { /* file missing, fall through */ }
      await this.downloadFile(url, dest);
      return dest;
    };

    // Resolve image to a local path (download / cache / use existing local file)
    const prepImage = async (scene: SceneWithMedia, i: number): Promise<string | undefined> => {
      if (!scene.imageUrl) {
        console.warn(`      Scene ${i + 1}: no image URL`);
        return undefined;
      }
      try {
        if (scene.imageUrl.startsWith("http")) {
          const dest = path.join(tempDir, `scene_${i}_image.png`);
          return await ensureCachedDownload(scene.imageUrl, dest);
        }
        if (fs.existsSync(scene.imageUrl)) {
          return path.isAbsolute(scene.imageUrl) ? scene.imageUrl : path.resolve(scene.imageUrl);
        }
        console.error(`    ✗ Local image missing: ${scene.imageUrl}`);
        return undefined;
      } catch (err: any) {
        console.error(`    ✗ Image prep failed (scene ${i + 1}): ${err.message}`);
        return undefined;
      }
    };

    const prepAudio = async (scene: SceneWithMedia, i: number): Promise<string | undefined> => {
      if (!scene.audioUrl) return undefined;
      try {
        const dest = path.join(tempDir, `scene_${i}_audio.mp3`);
        return await ensureCachedDownload(scene.audioUrl, dest);
      } catch (err: any) {
        console.error(`    ✗ Audio download failed (scene ${i + 1}): ${err.message}`);
        return undefined;
      }
    };

    // ── Phase 1: kick off ALL image + audio prep concurrently ──────────────
    const prepResults = await Promise.all(
      scenes.map(async (scene, i) => {
        const [imagePath, audioPath] = await Promise.all([
          prepImage(scene, i),
          prepAudio(scene, i),
        ]);
        return { scene, i, imagePath, audioPath };
      }),
    );
    console.log(`  ✓ Media downloaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // ── Phase 2: probe all audio durations in parallel ─────────────────────
    const t1 = Date.now();
    const probed = await Promise.all(
      prepResults.map(async ({ audioPath }) =>
        audioPath ? this.probeAudioDuration(audioPath).catch(() => 0) : 0,
      ),
    );
    console.log(`  ✓ ffprobe (×${probed.filter(p => p > 0).length}) in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

    // ── Phase 3: assemble MediaFile[] preserving scene order ───────────────
    const mediaFiles: MediaFile[] = [];
    prepResults.forEach(({ scene, i, imagePath, audioPath }, idx) => {
      if (!imagePath) {
        console.warn(`      Skipping scene ${i + 1} — no valid image`);
        return;
      }

      let sceneDuration: number;
      if (audioPath) {
        const p = probed[idx];
        if (p > 0) {
          sceneDuration = p + FADE_DURATION;
        } else {
          const fallback = scene.audioDuration ?? 0;
          sceneDuration  = Math.max(fallback, MIN_SCENE_DURATION);
        }
      } else {
        sceneDuration = MIN_SCENE_DURATION;
      }

      mediaFiles.push({
        image:     imagePath,
        audio:     audioPath,
        duration:  sceneDuration,
        narration: scene.narration ?? "",
      });
    });

    if (mediaFiles.length === 0) {
      throw new Error("No valid scenes with images found. Cannot create video.");
    }

    console.log(`  ${mediaFiles.length}/${scenes.length} scenes ready for assembly\n`);
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
          const rawTransitionMaybe = effectConfigs[i-1]?.transition;
          const VALID = ['fadeblack', 'fade', 'wiperight', 'wipeleft', 'hard-cut'];
          // Defensive: drop any unknown value (e.g. the frontend 'auto' marker)
          const rawTransition = (rawTransitionMaybe && VALID.includes(rawTransitionMaybe))
            ? rawTransitionMaybe
            : "fade";

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
          "-preset", "veryfast",
          "-crf",    "23",
          "-pix_fmt","yuv420p",
          "-c:a",    "aac",
          "-b:a",    "192k",
          "-ar",     "44100",
        ])
        .on("start",    (cmd) => console.log("FFmpeg:", cmd))
        .on("stderr",   (line) => console.log("  ffmpeg stderr:", line))
        .on("progress", (p) => {
          if (p.percent) {
            console.log(`  ${Math.round(p.percent)}%`);
            options.onProgress?.({
              step: 'rendering_video',
              message: `FFmpeg: ${Math.round(p.percent)}%`,
              percent: 70 + Math.round(p.percent * 0.2),
            });
          }
        })
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