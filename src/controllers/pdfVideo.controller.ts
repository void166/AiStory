import type { Request, Response } from "express";
import multer from "multer";
import { summariseDocument } from "../services/ai/pdfSummaryService";
import { createNotification } from "../services/notificationService";

/**
 * Multer config: keep PDFs in memory (we hand the buffer straight to the
 * parser & immediately discard it). 15 MB is large enough for a typical
 * 100-page lecture PDF but small enough that even a malicious client can't
 * easily exhaust server RAM.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf");
    if (!ok) return cb(new Error("Only PDF files are supported"));
    cb(null, true);
  },
});

/** Express middleware that runs multer & forwards multer errors as JSON. */
export const pdfUploadMiddleware = (req: Request, res: Response, next: Function) => {
  upload.single("pdf")(req, res, (err: any) => {
    if (err) {
      console.error("[pdfVideo] upload error:", err);
      const msg = err.code === "LIMIT_FILE_SIZE"
        ? "File too large (max 15 MB)"
        : (err.message || "Upload failed");
      return res.status(400).json({ success: false, error: msg });
    }
    next();
  });
};

/**
 * POST /api/video/pdf/summarise
 *
 * Body: multipart/form-data with `pdf` file.
 * Returns the extracted topic + suggested settings WITHOUT kicking off the
 * actual video generation. The frontend reviews/edits this and then submits
 * the regular /api/video/generate request.
 *
 * Splitting summarise from generate is intentional:
 *   - summarisation is cheap (~10 s) and the user wants to see/edit the
 *     proposed topic before burning a generation slot,
 *   - generation is expensive (~2-4 min) and we already have a working
 *     pipeline for it — no need to fork that flow.
 */
export async function summarisePdf(req: Request, res: Response) {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file || !file.buffer || file.buffer.length === 0) {
      return res.status(400).json({ success: false, error: "No PDF file uploaded" });
    }
    const userId = (req as any).user?.id as string | undefined;

    console.log(`📄 PDF received: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB)`);

    const summary = await summariseDocument(file.buffer);

    // Emit a notification so the user can find this in their bell history.
    if (userId) {
      createNotification({
        userId,
        type:    "pdf_processed",
        title:   "📄 PDF боловсруулагдлаа",
        message: `"${file.originalname}" — ${summary.pages} хуудас уншиж, "${summary.title.slice(0, 60)}" гэсэн сэдэв бэлэн.`,
        link:    null,
        data: {
          fileName: file.originalname,
          pages:    summary.pages,
          title:    summary.title,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        topic:             summary.topic,
        title:             summary.title,
        suggestedGenre:    summary.suggestedGenre,
        suggestedLanguage: summary.suggestedLanguage,
        pages:             summary.pages,
        rawChars:          summary.rawChars,
        fileName:          file.originalname,
      },
    });
  } catch (err: any) {
    console.error("[pdfVideo] summarisePdf failed:", err);
    return res.status(500).json({
      success: false,
      error:   err?.message || "Failed to process PDF",
    });
  }
}
