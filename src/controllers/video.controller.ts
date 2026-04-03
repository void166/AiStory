import { Request, Response } from "express";
import videoService from "../services/ai/videoService";
import scriptService from "../services/ai/scriptService";
import { Video } from "../model/Video";
import type { TransitionPreset } from "../services/ai/effects";
import { Scene } from "../model/Scenes";
import sequelize from "../config/db";
import { error } from "node:console";
import { AuthRequest } from "../middleware/auth.middleware";
import fs from "fs";
import path from "path";
import { Op } from "sequelize";


function getStringParam(param: string | string[] | undefined): string | null {
  if (!param) return null;
  return Array.isArray(param) ? param[0] : param;
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

      const result = await videoService.generateVideos(topic, {
        duration: duration || 60,
        genre: genre || "horror",
        language: language || "mongolian",
        imageStyle: imageStyle || "anime",
        voiceId: voiceId || undefined,
        bgmPath: bgmPath || "history1",
        bgmVolume: bgmVolume || "0.15",
        globalTransition: globalTransition || undefined, 
        sceneEffects: sceneEffects || undefined, 
        subtitleStyle: subtitleStyle || undefined, 
        disableSubtitles: disableSubtitles ?? false,
        ttsProvider:    ttsProvider    || 'gemini',
        scriptProvider: scriptProvider || 'anthropic',
      });

      console.log("\nVideo generation successful");

      console.log("\nSaviong to db");

      let t: Awaited<ReturnType<typeof sequelize.transaction>> | null = null;
      try {
        t = await sequelize.transaction();

        const video = await Video.create({
          userId: userId,
          projectId: projectId?.trim() ? projectId : null,
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
          thumbnail_url: result.thumbnail?.thumbnailUrl   ?? null,
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

        // Scene-үүдэд DB-ийн id-г нэмэн response-д оруулна
        const scenesWithIds = result.scenes.map((scene: any, index: number) => ({
          ...scene,
          id: createdScenes[index]?.id ?? undefined,
        }));

        res.status(200).json({
          success: true,
          data: {
            ...result,
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
        }
      );

      // Persist the new video URL (may now be a Cloudinary URL)
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
  // async regenSceneText(req: Request, res: Response): Promise<void> {
  //   try {
  //     const { what, scene, time, genre, narration, imagePrompt } = req.body;
  //     if (!what || !['narration', 'imagePrompt', 'both'].includes(what)) {
  //       res.status(400).json({ success: false, error: 'what must be: narration | imagePrompt | both' });
  //       return;
  //     }
  //     // Build a minimal script structure to feed regenerateScene
  //     const fakeScript = {
  //       title: '',
  //       duration: '',
  //       backgroundImages: [] as { id: number; prompt: string }[],
  //       script: [{
  //         time:        time        || '0:00-0:05',
  //         scene:       scene       || '',
  //         visual:      imagePrompt || '',
  //         narration:   narration   || '',
  //         imagePrompt: imagePrompt || '',
  //       }],
  //     };
  //     const regenResult = await scriptService.regenerateScene(fakeScript as any, 0);
  //     const data: Record<string, string> = {};
  //     if (what === 'narration' || what === 'both') data.narration = regenResult.narration;
  //     if (what === 'imagePrompt' || what === 'both') data.imagePrompt = regenResult.imagePrompt ?? regenResult.visual;
  //     res.status(200).json({ success: true, data });
  //   } catch (error: any) {
  //     console.error('\nregen-text error:', error);
  //     res.status(500).json({ success: false, error: error.message || 'Text regen failed' });
  //   }
  // }

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

      const { count, rows: videos } = await Video.findAndCountAll({
        where: { userId },
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
}

export default new VideoController();
