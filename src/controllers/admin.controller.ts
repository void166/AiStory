import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { Admin } from "../model/Admin";
import { User }  from "../model/User";
import { Video } from "../model/Video";
import { Scene } from "../model/Scenes";

const JWT_SECRET = process.env.JWT_SECRET as string;

class AdminController {
  // ─── POST /api/admin/login ───────────────────────────────────────────────────
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ success: false, message: "Email, password шаардлагатай" });
        return;
      }
      const admin = await Admin.findOne({ where: { email } });
      if (!admin) {
        res.status(401).json({ success: false, message: "Admin олдсонгүй" });
        return;
      }
      const match = await bcrypt.compare(password, admin.password);
      if (!match) {
        res.status(401).json({ success: false, message: "Нууц үг буруу" });
        return;
      }
      const token = jwt.sign(
        { id: admin.id, email: admin.email, role: admin.role, isAdmin: true },
        JWT_SECRET,
        { expiresIn: "7d" }
      );
      res.status(200).json({ success: true, token, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── POST /api/admin/register (superadmin only, or first-time setup) ─────────
  async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, name, role = "admin", secretKey } = req.body;
      if (secretKey !== (process.env.ADMIN_SECRET_KEY || "viralai-admin-2025")) {
        res.status(403).json({ success: false, message: "Secret key буруу" });
        return;
      }
      const existing = await Admin.findOne({ where: { email } });
      if (existing) {
        res.status(409).json({ success: false, message: "Email бүртгэлтэй байна" });
        return;
      }
      const hashed = await bcrypt.hash(password, 10);
      const admin = await Admin.create({ email, password: hashed, name, role });
      res.status(201).json({ success: true, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── GET /api/admin/stats ────────────────────────────────────────────────────
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const [totalUsers, totalVideos, completedVideos] = await Promise.all([
        User.count(),
        Video.count(),
        Video.count({ where: { status: "completed" } }),
      ]);
      res.status(200).json({
        success: true,
        data: { totalUsers, totalVideos, completedVideos, failedVideos: totalVideos - completedVideos },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── GET /api/admin/users ────────────────────────────────────────────────────
  async getUsers(req: Request, res: Response): Promise<void> {
    try {
      const page  = Math.max(1, parseInt(String(req.query.page  || "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
      const offset = (page - 1) * limit;

      const { count, rows } = await User.findAndCountAll({
        attributes: ["id", "email", "fullname", "createdAt"],
        order: [["createdAt", "DESC"]],
        limit,
        offset,
      });

      // attach video count per user
      const userIds = rows.map(u => u.id);
      const { Op: Op2 } = require("sequelize");
      const videoCounts = await Video.findAll({
        where: { userId: { [Op2.in]: userIds } },
        attributes: ["userId"],
      });
      const countMap: Record<string, number> = {};
      videoCounts.forEach((v: any) => {
        countMap[v.userId] = (countMap[v.userId] || 0) + 1;
      });

      const users = rows.map(u => ({
        id: u.id,
        email: u.email,
        fullname: u.fullname,
        createdAt: (u as any).createdAt,
        videoCount: countMap[u.id] || 0,
      }));

      res.status(200).json({ success: true, data: { users, total: count, page, limit } });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── GET /api/admin/videos ───────────────────────────────────────────────────
  async getVideos(req: Request, res: Response): Promise<void> {
    try {
      const page   = Math.max(1, parseInt(String(req.query.page   || "1"), 10));
      const limit  = Math.min(100, Math.max(1, parseInt(String(req.query.limit  || "30"), 10)));
      const offset = (page - 1) * limit;
      const search = (req.query.search as string) || "";

      const where: any = {};
      if (search) {
        const { Op } = require("sequelize");
        where.title = { [Op.iLike]: `%${search}%` };
      }

      const { count, rows: videos } = await Video.findAndCountAll({
        where,
        attributes: [
          "id","userId","projectId","title","topic","genre","language","imageStyle",
          "status","duration","final_video_url","thumbnail_url","bgmPath","bgmVolume",
          "Tfocus","Temotion","ToverLay","TvisualHook","createdAt","updatedAt",
        ],
        order: [["createdAt", "DESC"]],
        limit,
        offset,
      });

      // Attach user info
      const userIds = [...new Set(videos.map((v: any) => v.userId))] as string[];
      const { Op } = require("sequelize");
      const users   = await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ["id", "email", "fullname"],
      });
      const userMap: Record<string, any> = {};
      users.forEach(u => { userMap[u.id] = { id: u.id, email: u.email, fullname: u.fullname }; });

      const result = videos.map((v: any) => ({
        ...v.toJSON(),
        user: userMap[v.userId] || null,
      }));

      res.status(200).json({
        success: true,
        data: {
          videos: result,
          pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── GET /api/admin/videos/:videoId ─────────────────────────────────────────
  async getVideoDetail(req: Request, res: Response): Promise<void> {
    try {
      const videoId = String(req.params.videoId);
      const video = await Video.findByPk(videoId);
      if (!video) { res.status(404).json({ success: false, message: "Видео олдсонгүй" }); return; }

      const [user, scenes] = await Promise.all([
        User.findByPk(video.userId, { attributes: ["id", "email", "fullname", "createdAt"] }),
        Scene.findAll({ where: { videoId }, order: [["sceneIndex", "ASC"]] }),
      ]);

      res.status(200).json({ success: true, data: { video: video.toJSON(), user, scenes } });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // ─── DELETE /api/admin/videos/:videoId ──────────────────────────────────────
  async deleteVideo(req: Request, res: Response): Promise<void> {
    try {
      const videoId = String(req.params.videoId);
      const video = await Video.findByPk(videoId);
      if (!video) { res.status(404).json({ success: false, message: "Видео олдсонгүй" }); return; }
      await video.destroy();
      res.status(200).json({ success: true, message: "Устгасан" });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}

export default new AdminController();
