import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { Project } from "../model/Project";
import { Video }   from "../model/Video";

export class ProjectController {

  // ─── POST /api/projects ──────────────────────────────────────────────────────
  async createProject(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const { title, topic } = req.body;
      if (!title?.trim()) return res.status(400).json({ success: false, message: "Нэр шаардлагатай" });

      const project = await Project.create({ title: title.trim(), topic: topic || title.trim(), userId });
      return res.status(201).json({ success: true, data: project });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── GET /api/projects ───────────────────────────────────────────────────────
  async getProjects(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const projects = await Project.findAll({
        where: { userId },
        order: [["createdAt", "DESC"]],
      });

      // Attach video count per project
      const projectIds = projects.map(p => p.id);
      const videos = projectIds.length
        ? await Video.findAll({ where: { userId, projectId: projectIds as any }, attributes: ["projectId"] })
        : [];

      const countMap: Record<string, number> = {};
      videos.forEach((v: any) => { countMap[v.projectId] = (countMap[v.projectId] || 0) + 1; });

      // Count of videos without a project
      const unassigned = await Video.count({ where: { userId, projectId: null } });

      const result = projects.map(p => ({ ...p.toJSON(), videoCount: countMap[p.id] || 0 }));

      return res.status(200).json({ success: true, data: { projects: result, unassignedCount: unassigned } });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── GET /api/projects/:id ───────────────────────────────────────────────────
  async getProjectDetails(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const { id } = req.params;
      const project = await Project.findOne({ where: { id, userId } });
      if (!project) return res.status(404).json({ success: false, message: "Project олдсонгүй" });

      const videos = await Video.findAll({
        where: { projectId: id, userId },
        attributes: ["id","title","topic","genre","status","duration","final_video_url","thumbnail_url","Tfocus","createdAt"],
        order: [["createdAt", "DESC"]],
      });

      return res.status(200).json({ success: true, data: { project: project.toJSON(), videos } });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── PUT /api/projects/:id ───────────────────────────────────────────────────
  async renameProject(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const { id } = req.params;
      const { title } = req.body;
      if (!title?.trim()) return res.status(400).json({ success: false, message: "Нэр шаардлагатай" });

      const project = await Project.findOne({ where: { id, userId } });
      if (!project) return res.status(404).json({ success: false, message: "Project олдсонгүй" });

      project.title = title.trim();
      await project.save();

      return res.status(200).json({ success: true, data: project });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── DELETE /api/projects/:id ────────────────────────────────────────────────
  async deleteProject(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const { id } = req.params;
      const project = await Project.findOne({ where: { id, userId } });
      if (!project) return res.status(404).json({ success: false, message: "Project олдсонгүй" });

      // Unlink videos (don't delete them, just remove projectId)
      await Video.update({ projectId: null }, { where: { projectId: id, userId } });
      await project.destroy();

      return res.status(200).json({ success: true, message: "Project устгагдлаа" });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── PATCH /api/projects/move ────────────────────────────────────────────────
  // Move a video into a project (or remove from project with projectId: null)
  async moveVideo(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const { videoId, projectId } = req.body;
      if (!videoId) return res.status(400).json({ success: false, message: "videoId шаардлагатай" });

      const video = await Video.findOne({ where: { id: videoId, userId } });
      if (!video) return res.status(404).json({ success: false, message: "Видео олдсонгүй" });

      if (projectId) {
        const project = await Project.findOne({ where: { id: projectId, userId } });
        if (!project) return res.status(404).json({ success: false, message: "Project олдсонгүй" });
      }

      video.projectId = projectId || null;
      await video.save();

      return res.status(200).json({ success: true, data: { videoId, projectId: video.projectId } });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── GET /api/projects/unassigned ────────────────────────────────────────────
  async getUnassignedVideos(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const videos = await Video.findAll({
        where: { userId, projectId: null },
        attributes: ["id","title","topic","genre","status","duration","final_video_url","thumbnail_url","Tfocus","createdAt"],
        order: [["createdAt", "DESC"]],
      });

      return res.status(200).json({ success: true, data: { videos } });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

export default new ProjectController();
