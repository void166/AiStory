import { Request, Response } from 'express';
import { Video }      from '../model/Video';
import { Scene }      from '../model/Scenes';
import { Evaluation } from '../model/Evaluation';
import { evaluateVideo } from '../services/ai/evaluationService';
import scriptService from '../services/ai/scriptService';

function asString(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

class EvaluationController {

  /**
   * POST /api/video/:videoId/evaluate
   * Runs (or re-runs) the AI viral-score + health-checks for a video
   * and persists / updates the Evaluation row.
   */
  async evaluate(req: Request, res: Response): Promise<void> {
    try {
      const videoId = asString(req.params.videoId);
      if (!videoId) {
        res.status(400).json({ success: false, error: 'videoId is required' });
        return;
      }

      const video = await Video.findByPk(videoId);
      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }

      const sceneRows = await Scene.findAll({
        where: { videoId },
        order: [['sceneIndex', 'ASC']],
      });

      if (sceneRows.length === 0) {
        res.status(400).json({ success: false, error: 'No scenes found for this video' });
        return;
      }

      const sceneInputs = sceneRows.map(s => ({
        sceneIndex:    s.sceneIndex,
        time:          s.time,
        scene:         s.scene,
        narration:     s.narration,
        imagePrompt:   s.imagePrompt,
        audioDuration: s.audioDuration,
      }));

      const result = await evaluateVideo(
        video.topic,
        video.genre,
        sceneInputs,
        video.duration ?? undefined,
      );

      // Upsert: keep userRating / userLiked if a prior evaluation exists
      const existing = await Evaluation.findOne({ where: { videoId } });
      const payload  = {
        videoId,
        overallScore:     result.overallScore,
        grade:            result.grade,
        hookScore:        result.scores.hook,
        pacingScore:      result.scores.pacing,
        emotionScore:     result.scores.emotion,
        clarityScore:     result.scores.clarity,
        originalityScore: result.scores.originality,
        sceneScores:      JSON.stringify(result.sceneScores),
        suggestions:      JSON.stringify(result.suggestions),
        healthIssues:     JSON.stringify(result.healthIssues),
      };

      let saved;
      if (existing) {
        await existing.update(payload);
        saved = existing;
      } else {
        saved = await Evaluation.create(payload);
      }

      res.status(200).json({
        success: true,
        data: {
          id:           saved.id,
          videoId,
          overallScore: result.overallScore,
          grade:        result.grade,
          scores:       result.scores,
          sceneScores:  result.sceneScores,
          suggestions:  result.suggestions,
          healthIssues: result.healthIssues,
          userRating:   saved.userRating,
          userLiked:    saved.userLiked,
        },
      });
    } catch (err: any) {
      console.error('\n❌ Evaluation error:', err);
      res.status(500).json({ success: false, error: err.message || 'Evaluation failed' });
    }
  }

  /**
   * GET /api/video/:videoId/evaluation
   * Returns the most recent evaluation (or null if none yet).
   */
  async get(req: Request, res: Response): Promise<void> {
    try {
      const videoId = asString(req.params.videoId);
      if (!videoId) {
        res.status(400).json({ success: false, error: 'videoId is required' });
        return;
      }
      const ev = await Evaluation.findOne({ where: { videoId } });
      if (!ev) {
        res.status(200).json({ success: true, data: null });
        return;
      }
      res.status(200).json({
        success: true,
        data: {
          id:           ev.id,
          videoId:      ev.videoId,
          overallScore: ev.overallScore,
          grade:        ev.grade,
          scores: {
            hook:        ev.hookScore,
            pacing:      ev.pacingScore,
            emotion:     ev.emotionScore,
            clarity:     ev.clarityScore,
            originality: ev.originalityScore,
          },
          sceneScores:  ev.sceneScores  ? JSON.parse(ev.sceneScores)  : [],
          suggestions:  ev.suggestions  ? JSON.parse(ev.suggestions)  : [],
          healthIssues: ev.healthIssues ? JSON.parse(ev.healthIssues) : [],
          userRating:   ev.userRating,
          userLiked:    ev.userLiked,
        },
      });
    } catch (err: any) {
      console.error('\n❌ Evaluation get error:', err);
      res.status(500).json({ success: false, error: err.message || 'Failed to get evaluation' });
    }
  }

  /**
   * PATCH /api/video/:videoId/evaluation/rating
   * Body: { rating?: number (0–5), liked?: boolean | null }
   * Updates the user-facing feedback fields on the latest evaluation row,
   * creating a stub row if no AI evaluation has run yet.
   */
  async updateRating(req: Request, res: Response): Promise<void> {
    try {
      const videoId = asString(req.params.videoId);
      if (!videoId) {
        res.status(400).json({ success: false, error: 'videoId is required' });
        return;
      }
      const { rating, liked } = req.body as { rating?: number; liked?: boolean | null };

      const video = await Video.findByPk(videoId);
      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }

      let ev = await Evaluation.findOne({ where: { videoId } });
      if (!ev) {
        ev = await Evaluation.create({
          videoId,
          overallScore: 0, grade: 'C',
          hookScore: 0, pacingScore: 0, emotionScore: 0, clarityScore: 0, originalityScore: 0,
        });
      }

      if (typeof rating === 'number') {
        ev.userRating = Math.max(0, Math.min(5, rating));
      }
      if (liked === null || typeof liked === 'boolean') {
        ev.userLiked = liked;
      }
      await ev.save();

      res.status(200).json({
        success: true,
        data: { userRating: ev.userRating, userLiked: ev.userLiked },
      });
    } catch (err: any) {
      console.error('\n❌ Rating update error:', err);
      res.status(500).json({ success: false, error: err.message || 'Rating update failed' });
    }
  }

  /**
   * POST /api/script/variants
   * Body: { topic, genre?, imageStyle?, language?, duration?, scriptProvider? }
   * Returns 2 script variants (different angle/tone) so the user can compare.
   * No DB writes — variants are returned to the client only.
   */
  async generateVariants(req: Request, res: Response): Promise<void> {
    try {
      const { topic, genre, imageStyle, language, duration, scriptProvider } = req.body as {
        topic?: string;
        genre?: string;
        imageStyle?: string;
        language?: string;
        duration?: number;
        scriptProvider?: 'anthropic' | 'groq';
      };

      if (!topic || topic.trim().length === 0) {
        res.status(400).json({ success: false, error: 'topic is required' });
        return;
      }

      // Two parallel generations with the same topic so the user can compare
      const [a, b] = await Promise.all([
        scriptService.generate(topic, imageStyle ?? 'anime', {
          duration, genre, language, provider: scriptProvider ?? 'anthropic',
        }),
        // Bias the second variant with a small topic hint to encourage divergence
        scriptService.generate(`${topic} — alternative angle, different hook`, imageStyle ?? 'anime', {
          duration, genre, language, provider: scriptProvider ?? 'anthropic',
        }),
      ]);

      res.status(200).json({
        success: true,
        data: {
          variants: [
            { id: 'A', title: a.title, duration: a.duration, scenes: a.script },
            { id: 'B', title: b.title, duration: b.duration, scenes: b.script },
          ],
        },
      });
    } catch (err: any) {
      console.error('\n❌ Variants error:', err);
      res.status(500).json({ success: false, error: err.message || 'Variant generation failed' });
    }
  }
}

export default new EvaluationController();
