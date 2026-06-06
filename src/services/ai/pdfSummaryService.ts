/**
 * PDF / document → topic summary service.
 *
 * Takes raw bytes of an uploaded document, extracts text, and asks Claude to
 * compress it into a viral-video-friendly *topic line* + short context. The
 * output `topic` is plugged straight into the existing video pipeline (which
 * does its own scripting), so this service only owns the
 * "long text → 1-paragraph hook" step.
 */
import Anthropic from "@anthropic-ai/sdk";
// pdf-parse v2.x exposes a class-based API (PDFParse) instead of a default
// function. We instantiate per-document and call `getText()` to pull the
// concatenated text + per-page array.
import { PDFParse } from "pdf-parse";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.warn("⚠️  ANTHROPIC_API_KEY missing — PDF summarisation will fail.");
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

/** Max characters of PDF text we feed to the LLM. ~24 K chars ≈ 8 K tokens. */
const MAX_CHARS = 24_000;

export interface PdfSummary {
  /** Compressed topic string ready to pass to `videoService.generateVideos`. */
  topic:       string;
  /** Short human-readable title for the video. */
  title:       string;
  /** Suggested genre slug — matches the frontend GENRES list. */
  suggestedGenre: string;
  /** Suggested language — 'mongolian' or 'english'. */
  suggestedLanguage: 'mongolian' | 'english';
  /** Number of pages parsed from the PDF. */
  pages:       number;
  /** Total characters extracted (raw, pre-truncation). */
  rawChars:    number;
}

/** Strip control chars and collapse whitespace so the LLM gets clean text. */
function clean(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse the PDF bytes, extract text, then hand it to Claude to produce a
 * viral-video-friendly topic. Throws if the PDF has no recoverable text
 * (e.g. scanned image-only PDFs).
 */
export async function summariseDocument(buffer: Buffer): Promise<PdfSummary> {
  // pdf-parse@2 auto-converts Node `Buffer` → `Uint8Array` internally.
  const parser = new PDFParse({ data: buffer });
  let textResult;
  try {
    textResult = await parser.getText();
  } finally {
    // Always free the underlying pdfjs document.
    await parser.destroy().catch(() => {/* ignore */});
  }
  const numPages = textResult.pages?.length ?? 0;
  const rawText = clean(textResult.text || "");
  const rawChars = rawText.length;

  if (!rawText || rawChars < 50) {
    throw new Error(
      "PDF doesn't seem to have extractable text — is it a scanned image? " +
      "Try OCR-ing it first or upload a text-based PDF.",
    );
  }

  const truncated = rawChars > MAX_CHARS
    ? rawText.slice(0, MAX_CHARS) + "\n\n[... truncated ...]"
    : rawText;

  const sys = `You convert long documents into VIRAL short-form video TOPICS.
Your output must be STRICT JSON, no markdown, no commentary.`;

  const user = `Below is the extracted text of an uploaded document.
Read it, then produce a JSON object with these fields:

{
  "title": "<5-8 word catchy video title>",
  "topic": "<2-3 sentence topic the video should cover, written like a YouTube/TikTok hook — punchy, emotional, specific. Mention the 2-3 most surprising facts from the document.>",
  "suggestedGenre": "<one of: scary, trueCrime, conspiracy, darkHistory, psychology, mythology, stoic, mythBusting, survival, futuristic, biography, shockingFacts, business, sciExplained, education>",
  "suggestedLanguage": "<mongolian if the source is in Cyrillic, otherwise english>"
}

DOCUMENT TEXT:
"""
${truncated}
"""

Return ONLY the JSON object.`;

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  const text = resp.content
    .filter(b => b.type === "text")
    .map(b => (b as { text: string }).text)
    .join("")
    .trim();

  // The model sometimes wraps JSON in ```json``` despite instructions —
  // strip code fences defensively.
  const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  let summary: Partial<PdfSummary>;
  try {
    summary = JSON.parse(jsonText);
  } catch (err) {
    console.error("Failed to parse Claude summary JSON. Raw:", text);
    throw new Error("Failed to parse summary — please retry");
  }

  // Hard validation: every downstream caller expects these fields.
  if (!summary.topic || typeof summary.topic !== "string") {
    throw new Error("Summary missing 'topic' field");
  }

  const lang: 'mongolian' | 'english' =
    summary.suggestedLanguage === 'mongolian' ? 'mongolian' : 'english';

  return {
    topic:             summary.topic,
    title:             summary.title             ?? summary.topic.slice(0, 60),
    suggestedGenre:    summary.suggestedGenre    ?? "education",
    suggestedLanguage: lang,
    pages:             numPages,
    rawChars,
  };
}
