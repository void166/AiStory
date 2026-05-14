import { Request, Response } from "express";
import videoService from "../services/ai/videoService";
import scriptService from "../services/ai/scriptService";
import { Video } from "../model/Video";
import type { TransitionPreset } from "../services/ai/effects";
import { Scene } from "../model/Scenes";
import { Project } from "../model/Project";
import sequelize from "../config/db";
import { error } from "node:console";
import { AuthRequest } from "../middleware/auth.middleware";
import fs from "fs";
import path from "path";
import { Op } from "sequelize";
import { progressEmitter, emitProgress } from "../services/progressEmitter";
import cloudinaryService from "../services/storage/cloudinaryService";


function getStringParam(param: string | string[] | undefined): string | null {
  if (!param) return null;
  return Array.isArray(param) ? param[0] : param;
}

// ─── Cancellation registry ──────────────────────────────────────────────────
// Maps jobId → AbortController so the cancel endpoint can signal an
// in-progress generation to stop and persist its partial work as a draft.
const activeJobs = new Map<string, AbortController>();

export function getActiveJobController(jobId: string): AbortController | undefined {
  return activeJobs.get(jobId);
}

export class CancellationError extends Error {
  public partial: any;
  constructor(message: string, partial: any) {
    super(message);
    this.name = 'CancellationError';
    this.partial = partial;
  }
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
        userId,
        projectId,
        title,
        ttsProvider,
        scriptProvider,
        jobId,
      } = req.body;


      if (!topic || topic.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: "Topic is required",
        });
        return;
      }

      if(!userId){
        res.status(400).json({
          success: false,
          error: "user id is required"
        });
        return;
      }

      console.log("\n📥 Video generation request received:");
      console.log("  Topic:", topic);
      console.log("  Duration:", duration || 60);
      console.log("  Genre:", genre || "horror");
      console.log("  Language:", language || "mongolian");
      console.log("  BGM:", bgmPath || "history1");
      console.log("  Subtitles disabled:", disableSubtitles ?? false);
      console.log("projectId: ", projectId);

      // Register an AbortController so /cancel can signal this job
      const abortController = new AbortController();
      if (jobId) activeJobs.set(jobId, abortController);

      let result;
      try {
        result = await videoService.generateVideos(topic, {
          duration: duration || 60,
          genre: genre || "horror",
          language: language || "mongolian",
          imageStyle: imageStyle || "anime",
          voiceId: voiceId || undefined,
          // Respect explicit empty string (= user wants no music)
          bgmPath: bgmPath !== undefined ? bgmPath : "history1",
          bgmVolume: typeof bgmVolume === 'number' ? String(bgmVolume) : (bgmVolume || "0.15"),
          // 'auto' (and unknown values) → leave undefined so assignSceneEffects picks at random
          globalTransition: (globalTransition && globalTransition !== 'auto')
            ? globalTransition
            : undefined,
          sceneEffects: sceneEffects || undefined,
          subtitleStyle: subtitleStyle || undefined,
          disableSubtitles: disableSubtitles ?? false,
          ttsProvider:    ttsProvider    || 'gemini',
          scriptProvider: scriptProvider || 'anthropic',
          onProgress: jobId ? (event) => emitProgress(jobId, event) : undefined,
          signal: abortController.signal,
        });
      } catch (err: any) {
        if (jobId) activeJobs.delete(jobId);
        // User cancelled mid-generation: save partial work as a draft Video
        if (err instanceof CancellationError || err?.name === 'CancellationError' || abortController.signal.aborted) {
          const partial = err?.partial ?? {};
          console.log('🛑 Generation cancelled, saving partial state as draft');

          let safeProjectId: string | null = null;
          if (projectId && typeof projectId === 'string' && projectId.trim()) {
            const project = await Project.findOne({ where: { id: projectId.trim(), userId } });
            if (project) safeProjectId = projectId.trim();
          }

          const t = await sequelize.transaction();
          try {
            const draft = await Video.create({
              userId,
              projectId: safeProjectId,
              title: title || topic,
              topic,
              genre: genre || "horror",
              language: language || "mongolian",
              imageStyle: imageStyle || "anime",
              bgmPath: bgmPath !== undefined ? bgmPath : "history1",
              bgmVolume: typeof bgmVolume === 'number' ? bgmVolume : 0.15,
              duration: partial?.duration || duration || 60,
              status: "draft",
              progress: partial?.progress ?? 0,
              final_video_url: null,
              srtPath: null,
              thumbnail_url: null,
              Tfocus:      partial?.thumbnail?.focus       ?? null,
              Temotion:    partial?.thumbnail?.emotion     ?? null,
              ToverLay:    partial?.thumbnail?.textOverlay ?? null,
              TvisualHook: partial?.thumbnail?.visualHook  ?? null,
            } as any, { transaction: t });

            // Save whatever scenes were produced so the user can pick up where they left off
            if (Array.isArray(partial?.scenes) && partial.scenes.length > 0) {
              const scenesData = partial.scenes.map((scene: any, index: number) => ({
                videoId:        draft.id,
                sceneIndex:     index,
                time:           scene.time   ?? `${index*5}:00`,
                scene:          scene.scene  ?? `Scene ${index + 1}`,
                narration:      scene.narration || null,
                imagePrompt:    scene.imagePrompt || scene.visual || null,
                imageUrl:       scene.imageUrl || null,
                audioUrl:       scene.audioUrl || null,
                audioDuration:  scene.audioDuration || null,
                words:          scene.words ? JSON.stringify(scene.words) : null,
                transitionType: scene.transition   || null,
                motionEffect:   scene.motionEffect || null,
                voiceId:        voiceId || null,
                ttsProvider:    scene.ttsProvider || ttsProvider || 'gemini',
              }));
              await Scene.bulkCreate(scenesData, { transaction: t });
            }
            await t.commit();

            res.status(200).json({
              success: true,
              cancelled: true,
              data: {
                videoId: draft.id,
                status: 'draft',
                scenesCount: Array.isArray(partial?.scenes) ? partial.scenes.length : 0,
              },
              message: 'Generation cancelled. Draft saved.',
            });
            return;
          } catch (dbErr: any) {
            await t.rollback();
            console.error('Failed to save draft after cancellation:', dbErr);
            res.status(500).json({ success: false, error: 'Cancelled, but failed to save draft' });
            return;
          }
        }
        throw err;
      } finally {
        if (jobId) activeJobs.delete(jobId);
      }

      console.log("\nVideo generation successful");

      console.log("\nSaviong to db");

      // Validate projectId exists & belongs to this user; else fall back to null.
      // Prevents FK constraint violation on Video.create when frontend sends
      // a stale / deleted project id.
      let safeProjectId: string | null = null;
      if (projectId && typeof projectId === 'string' && projectId.trim()) {
        const project = await Project.findOne({ where: { id: projectId.trim(), userId } });
        if (project) {
          safeProjectId = projectId.trim();
        } else {
          console.warn(`⚠️  Project ${projectId} not found for user ${userId} — saving video as unassigned`);
        }
      }

      let t: Awaited<ReturnType<typeof sequelize.transaction>> | null = null;
      try {
        t = await sequelize.transaction();

        const video = await Video.create({
          userId: userId,
          projectId: safeProjectId,
          title: title || topic,
          topic,
          genre: genre || "horror",
          language: language || "mongolian",
          imageStyle: imageStyle || "anime",
          bgmPath: bgmPath || "history1",
          bgmVolume: parseFloat(bgmVolume) || 0.15,
          duration: result.duration || duration || 60,
          status: "completed",
          progress: 100,
          final_video_url: result.videoUrl || null,
          srtPath: result.srtPath || null,
          // thumbnail_url is filled in by the background job below
          thumbnail_url: null,
          Tfocus:        result.thumbnail?.focus           ?? null,
          Temotion:      result.thumbnail?.emotion         ?? null,
          ToverLay:      result.thumbnail?.textOverlay     ?? null,
          TvisualHook:   result.thumbnail?.visualHook      ?? null,
        });

        let createdScenes: any[] = [];
        if (result.scenes && Array.isArray(result.scenes) && result.scenes.length > 0) {
          const scenesData = result.scenes.map((scene: any, index: number) => ({
            videoId:        video.id,
            sceneIndex:     index,
            time:           scene.time,
            scene:          scene.scene,
            narration:      scene.narration || null,
            imagePrompt:    scene.imagePrompt || scene.visual || null,
            imageUrl:       scene.imageUrl || null,
            audioUrl:       scene.audioUrl || null,
            audioDuration:  scene.audioDuration || null,
            words:          scene.words ? JSON.stringify(scene.words) : null,
            transitionType: scene.transition   || null,
            motionEffect:   scene.motionEffect || null,
            voiceId:        voiceId || null,
            ttsProvider:    scene.ttsProvider || ttsProvider || 'gemini',
          }));

          // bulkCreate буцааж ирэх instances-д UUID id байна
          createdScenes = await Scene.bulkCreate(scenesData, { transaction: t });
        }

        await t.commit();
        console.log('Successfully saved Video and all Scenes to DB');

        // ── Kick off thumbnail generation in the background ─────────────────
        // The user gets their video right away; the thumbnail trickles in a
        // few seconds later and the Video.thumbnail_url column is updated
        // once the Cloudinary URL is ready.
        if (result.thumbnail?.focus && result.thumbnail?.visualHook) {
          videoService.generateThumbnailForVideoInBackground(
            video.id,
            {
              focus:       result.thumbnail.focus,
              emotion:     result.thumbnail.emotion,
              visualHook:  result.thumbnail.visualHook,
              textOverlay: result.thumbnail.textOverlay,
            },
            imageStyle || 'cinematic',
          );
        }

        // ── Patch Scene.imageUrl with Cloudinary URLs as they finish ────────
        // Each scene's image was saved with its LOCAL path so FFmpeg could
        // assemble immediately. The actual Cloudinary upload runs async — when
        // each one resolves, swap the DB column over to the CDN URL.
        if (result.sceneCloudUrlPromises?.length && createdScenes.length) {
          result.sceneCloudUrlPromises.forEach((p, idx) => {
            const sceneRow = createdScenes[idx];
            if (!sceneRow) return;
            p.then(async (cloudUrl) => {
              try {
                await Scene.update({ imageUrl: cloudUrl }, { where: { id: sceneRow.id } });
                console.log(`☁️  Scene ${idx + 1} (${sceneRow.id}) imageUrl → CDN`);
              } catch (err: any) {
                console.warn(`⚠️  Failed to patch scene ${idx + 1} imageUrl: ${err.message}`);
              }
            }).catch(err => {
              console.warn(`⚠️  Scene ${idx + 1} Cloudinary upload failed: ${err.message}`);
            });
          });
        }

        // Scene-үүдэд DB-ийн id-г нэмэн response-д оруулна
        const scenesWithIds = result.scenes.map((scene: any, index: number) => ({
          ...scene,
          id: createdScenes[index]?.id ?? undefined,
        }));

        res.status(200).json({
          success: true,
          data: {
            ...result,
            // Override the service's internal vid_xxx ID with the real DB UUID
            // so the frontend always uses the UUID for reassemble / status calls.
            videoId: video.id,
            scenes: scenesWithIds,
            dbId: video.id,
          },
          message: 'Video generated and saved successfully'
        });
      } catch (dbError: any) {
        if (t) await t.rollback();
        console.error('\nDatabase saving error (Rolled back):', dbError);
        throw new Error(`Failed to save to database: ${dbError.message}`);
      }
    } catch (error: any) {
      console.error("\nVideo generation error:", error);

      res.status(500).json({
        success: false,
        error: error.message || "Video generation failed",
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  async regenerateScene(req: Request, res: Response): Promise<void> {
    try {
      const videoId = getStringParam(req.params.videoId);
      const {
        sceneIndex,
        regenerateWhat,
        imagePrompt,
        narration,
        time,
        scene,
      } = req.body;

      if (!videoId) {
        res.status(400).json({ success: false, error: "Video ID is required" });
        return;
      }

      if (sceneIndex === undefined || sceneIndex < 0) {
        res
          .status(400)
          .json({ success: false, error: "Valid scene index is required" });
        return;
      }

      if (!["audio", "image", "both"].includes(regenerateWhat)) {
        res
          .status(400)
          .json({
            success: false,
            error: "regenerateWhat must be: audio, image, or both",
          });
        return;
      }

      console.log(
        `\nRegenerate request: ${videoId} / scene ${sceneIndex} / ${regenerateWhat}`
      );

      const result = await videoService.regenerateSceneMedia(
        videoId,
        sceneIndex,
        regenerateWhat,
        { imagePrompt, narration, time, scene }
      );

      res.status(200).json({
        success: true,
        data: result,
        message: `Scene ${regenerateWhat} regenerated successfully`,
      });
    } catch (error: any) {
      console.error("\n❌ Scene regeneration error:", error);
      res
        .status(500)
        .json({
          success: false,
          error: error.message || "Scene regeneration failed",
        });
    }
  }

  async reGenImage(req: Request, res: Response): Promise<void> {
    try {
      const id = getStringParam(req.params.id);
      if (!id) { res.status(400).json({ success: false, error: 'Scene ID is required' }); return; }
      const { imagePrompt } = req.body;
      if (!imagePrompt) { res.status(400).json({ success: false, error: 'imagePrompt required' }); return; }

      const result = await videoService.reGenImage(id, imagePrompt);
      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      console.error('\nreGenImage error:', err.message);
      res.status(500).json({ success: false, error: err.message || 'Image regeneration failed' });
    }
  }

  async reGenNarration(req: Request, res: Response): Promise<void> {
    try {
      const id = getStringParam(req.params.id);
      if (!id) { res.status(400).json({ success: false, error: 'Scene ID is required' }); return; }
      const { narration } = req.body;
      if (!narration) { res.status(400).json({ success: false, error: 'narration required' }); return; }

      const result = await videoService.reGenNarration(id, narration);
      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      console.error('\nreGenNarration error:', err.message);
      res.status(500).json({ success: false, error: err.message || 'Narration regeneration failed' });
    }
  }

  async getVideoStatus(req: Request, res: Response): Promise<void> {
    try {
      const videoId = getStringParam(req.params.videoId);

      if (!videoId) {
        res.status(404).json({ success: false, error: "Video ID is required" });
        return;
      }

      const [videoResult, videoRow] = await Promise.all([
        videoService.getVideoStatus(videoId),
        Video.findByPk(videoId, { attributes: ['id','topic','genre','bgmPath','bgmVolume','imageStyle','language'] }),
      ]);

      if (!videoResult || !videoRow) {
        res.status(404).json({ success: false, error: "Video not found" });
        return;
      }

      // Merge extra fields the frontend (EditStudio) needs
      const responseData = {
        ...videoResult,
        topic:   videoRow.topic,
        dbId:    videoRow.id,
        options: {
          genre:   videoRow.genre,
          bgmPath: videoRow.bgmPath ?? '',
        },
        // Attach DB scene ids to each scene for reGenImage / reGenNarration
        scenes: videoResult.scenes.map((s: any) => ({
          ...s,
          audioDuration: s.audioDuration ?? 0,
        })),
      };

      res.status(200).json({ success: true, data: responseData });
    } catch (error: any) {
      console.error("\n❌ Get video status error:", error);
      res
        .status(500)
        .json({
          success: false,
          error: error.message || "Failed to get video status",
        });
    }
  }

  async reAssembleVideo(req: Request, res: Response): Promise<void> {
    try {
      const videoId = getStringParam(req.params.videoId);
      if (!videoId) {
        res.status(400).json({ success: false, error: "Video ID is required" });
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
        res
          .status(400)
          .json({ success: false, error: "scenes array is required" });
        return;
      }

      const VALID_TRANSITIONS: TransitionPreset[] = [
        "fadeblack",
        "fade",
        "wiperight",
        "wipeleft",
        "hard-cut",
      ];

      const sceneEffects: Array<{ transition?: TransitionPreset }> = scenes.map(
        (_: unknown, i: number) => {
          const t = sceneTransitions?.[i];
          return {
            transition: VALID_TRANSITIONS.includes(t)
              ? (t as TransitionPreset)
              : undefined,
          };
        }
      );

      console.log(
        `\n🔁 Re-assemble request: ${videoId} / ${scenes.length} scenes`
      );

      const result = await videoService.reAssembleVideo(
        videoId,
        scenes,
        title || "Video",
        {
          sceneEffects,
          subtitleStyle:    subtitleStyle    || undefined,
          disableSubtitles: disableSubtitles ?? false,
          bgmPath:          bgmPath          || undefined,
          bgmVolume:        bgmVolume        || "0.15",
          genre:            genre            || undefined,
        },
        // Background callback: when the Cloudinary upload finishes, swap the
        // DB URL from the local /output/... path to the CDN URL.
        async (cloudUrl) => {
          try {
            await Video.update(
              { final_video_url: cloudUrl },
              { where: { id: videoId } },
            );
            console.log(`☁️  Video ${videoId} final_video_url → CDN`);
          } catch (err: any) {
            console.warn(`⚠️  Could not update video ${videoId} CDN URL: ${err.message}`);
          }
        },
      );

      // Persist the local URL right away so the frontend can play immediately.
      // It will be overwritten with the Cloudinary URL by the background job above.
      await Video.update(
        { final_video_url: result.videoUrl },
        { where: { id: videoId } },
      );

      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.error("\n Re-assemble error:", error);
      res
        .status(500)
        .json({ success: false, error: error.message || "Re-assemble failed" });
    }
  }

  /**
   * POST /api/video/:videoId/regen-text
   * AI rewrites narration or imagePrompt for one scene
   */
   async regenSceneText(req: Request, res: Response): Promise<void> {
  try {
     const { what, scene, time, genre, narration, imagePrompt } = req.body;
       if (!what || !['narration', 'imagePrompt', 'both'].includes(what)) {
         res.status(400).json({ success: false, error: 'what must be: narration | imagePrompt | both' });
         return;
       }
       // Build a minimal script structure to feed regenerateScene
       const fakeScript = {
         title: '',
         duration: '',
         backgroundImages: [] as { id: number; prompt: string }[],
         script: [{
           time:        time        || '0:00-0:05',
           scene:       scene       || '',
           visual:      imagePrompt || '',
           narration:   narration   || '',
           imagePrompt: imagePrompt || '',
         }],
       };
       const regenResult = await scriptService.regenerateScene(fakeScript as any, 0);
       const data: Record<string, string> = {};
       if (what === 'narration' || what === 'both') data.narration = regenResult.narration;
       if (what === 'imagePrompt' || what === 'both') data.imagePrompt = regenResult.imagePrompt ?? regenResult.visual;
       res.status(200).json({ success: true, data });
     } catch (error: any) {
       console.error('\nregen-text error:', error);
       res.status(500).json({ success: false, error: error.message || 'Text regen failed' });
     }
   }

  /**
   * GET /api/video
   * Хэрэглэгчийн бүх видеог хуудасчилсан байдлаар буцаана
   */
  async getUserVideos(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }

      const page  = Math.max(1, parseInt(String(req.query.page  || "1"),  10));
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
      const offset = (page - 1) * limit;

      // ?status=completed | draft | failed   (default: completed only)
      const statusParam = String(req.query.status ?? "completed").trim();
      const where: any = { userId };
      if (statusParam === "all") {
        // no status filter
      } else if (statusParam === "draft") {
        where.status = "draft";
      } else if (statusParam === "failed") {
        where.status = "failed";
      } else {
        // default: only show finished, watchable videos
        where.status = "completed";
      }

      const { count, rows: videos } = await Video.findAndCountAll({
        where,
        attributes: [
          "id", "title", "topic", "genre", "language", "imageStyle",
          "status", "duration", "final_video_url",
          "thumbnail_url",
          "Tfocus",
          "Temotion",
          "ToverLay",
          "TvisualHook",
          "bgmPath", "bgmVolume", "createdAt", "updatedAt",
        ],
        order:  [["createdAt", "DESC"]],
        limit,
        offset,
      });

      res.status(200).json({
        success: true,
        data: {
          videos,
          pagination: {
            total: count,
            page,
            limit,
            totalPages: Math.ceil(count / limit),
          },
        },
      });
    } catch (err: any) {
      console.error("\n❌ getUserVideos error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch videos" });
    }
  }

  /**
   * DELETE /api/video/:videoId
   * Видео болон холбогдох scene-үүдийг устгана (DB + локал файл)
   */
  async deleteVideo(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId  = (req as any).user?.id;
      const videoId = getStringParam(req.params.videoId);

      if (!userId) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }
      if (!videoId) {
        res.status(400).json({ success: false, error: "Video ID is required" });
        return;
      }

      const video = await Video.findOne({ where: { id: videoId, userId } });
      if (!video) {
        res.status(404).json({ success: false, error: "Video not found" });
        return;
      }

      // Локал файлуудыг устга (mp4, srt)
      const tryUnlink = (filePath: string | null | undefined) => {
        if (!filePath) return;
        try {
          // final_video_url may be a relative path like /output/xxx.mp4 or full path
          const absPath = filePath.startsWith("/")
            ? filePath
            : path.join(process.cwd(), filePath.replace(/^\//, ""));
          if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
        } catch {}
      };

      tryUnlink(video.final_video_url);
      tryUnlink(video.srtPath);

      // DB-ээс устга (Scenes нь CASCADE-ээр дагж устна)
      await video.destroy();

      console.log(`🗑️  Deleted video ${videoId} for user ${userId}`);
      res.status(200).json({ success: true, message: "Video deleted successfully" });
    } catch (err: any) {
      console.error("\n❌ deleteVideo error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to delete video" });
    }
  }

  getProgressStream(req: Request, res: Response): void {
    const { jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const handler = (data: object) => send(data);
    progressEmitter.on(`job:${jobId}`, handler);

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    req.on('close', () => {
      progressEmitter.off(`job:${jobId}`, handler);
      clearInterval(heartbeat);
    });
  }

  async testGeneration(req: Request, res: Response): Promise<void> {
    try {
      console.log("\n🧪 Running test generation...");

      const testResult = await videoService.generateVideos(
        "Хар сүүдрийн нууц",
        {
          duration: 20,
          genre: "horror",
          language: "mongolian",
          imageStyle: "anime",
          voiceId: "JBFqnCBsd6RMkjVDRZzb",
          bgmPath: "scary1",
          bgmVolume: "0.15",
          disableSubtitles: false,
        }
      );

      res.status(200).json({
        success: true,
        data: testResult,
        message: "Test generation completed",
      });
    } catch (error: any) {
      console.error("\n❌ Test generation error:", error);
      res
        .status(500)
        .json({ success: false, error: error.message, details: error.stack });
    }
  }

  /**
   * POST /api/video/upload-asset
   * Upload a custom audio / image / bgm asset to Cloudinary.
   * Body: { kind: 'audio'|'image'|'bgm', base64, mimeType?, sceneId? }
   *   - audio + sceneId  → updates scene.audioUrl
   *   - image + sceneId  → updates scene.imageUrl
   *   - bgm              → just returns the Cloudinary URL (frontend stores in bgmPath)
   * Response: { url: string, audioDuration?: number }
   */
  async uploadAsset(req: Request, res: Response): Promise<void> {
    try {
      const { kind, base64, mimeType, sceneId } = req.body as {
        kind?: "audio" | "image" | "bgm";
        base64?: string;
        mimeType?: string;
        sceneId?: string;
      };

      if (!kind || !["audio", "image", "bgm"].includes(kind)) {
        res.status(400).json({ success: false, error: "kind must be: audio | image | bgm" });
        return;
      }
      if (!base64) {
        res.status(400).json({ success: false, error: "base64 is required" });
        return;
      }

      // Strip data URL prefix if present (e.g. "data:audio/mpeg;base64,...")
      const cleaned = base64.includes(",") ? base64.split(",")[1] : base64;
      const buffer  = Buffer.from(cleaned, "base64");

      const folder   = kind === "image" ? "viralai/custom-images"
                     : kind === "audio" ? "viralai/custom-audio"
                     :                    "viralai/custom-bgm";
      const filename = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      console.log(
        `\n📤 Uploading custom ${kind} (${(buffer.length / 1024).toFixed(1)} KB) → ${folder}`
      );

      const url = await cloudinaryService.uploadBuffer(buffer, filename, folder);

      // If the upload is for a known scene, persist the new URL onto that scene
      if (sceneId && (kind === "audio" || kind === "image")) {
        const scene = await Scene.findOne({ where: { id: sceneId } });
        if (scene) {
          if (kind === "audio") scene.audioUrl = url;
          else                  scene.imageUrl = url;
          await scene.save();
          console.log(`  ✓ Scene ${sceneId} ${kind}Url updated`);
        } else {
          console.warn(`  ⚠️  Scene ${sceneId} not found — URL returned but DB not updated`);
        }
      }

      res.status(200).json({ success: true, data: { url } });
    } catch (error: any) {
      console.error("\n❌ Upload asset error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Upload failed",
      });
    }
  }

  /**
   * POST /api/video/cancel/:jobId
   * Signals an in-progress generation to abort. The /generate endpoint that
   * owns the job will catch the abort, save the partial state as a draft Video,
   * and respond to its caller with { cancelled: true, data: { videoId } }.
   */
  async cancelGeneration(req: Request, res: Response): Promise<void> {
    const jobId = getStringParam(req.params.jobId);
    if (!jobId) {
      res.status(400).json({ success: false, error: 'jobId is required' });
      return;
    }
    const controller = activeJobs.get(jobId);
    if (!controller) {
      res.status(404).json({ success: false, error: 'No active job with that id' });
      return;
    }
    controller.abort();
    console.log(`🛑 Cancel requested for job ${jobId}`);
    res.status(200).json({ success: true, message: 'Cancel signal sent' });
  }
}

export default new VideoController();
