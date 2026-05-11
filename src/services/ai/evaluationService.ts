/**
 * Video evaluation service
 *  - AI Viral Score: 5 LLM-rated criteria (hook, pacing, emotion, clarity, originality)
 *  - Per-scene scores: which scenes are the weakest
 *  - Health checks: deterministic rule-based warnings (no LLM)
 */

import Groq from 'groq-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';

const { GROQ_API, ANTHROPIC_API_KEY } = config;

const groq      = GROQ_API          ? new Groq({ apiKey: GROQ_API })            : null;
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// ─── Types ───────────────────────────────────────────────────────────────────
export interface SceneInput {
  sceneIndex:    number;
  time?:         string;
  scene?:        string;
  narration?:    string | null;
  imagePrompt?:  string | null;
  audioDuration?: number | null;
}

export interface EvaluationResult {
  overallScore: number;
  grade:        string;          // A+, A, B+, B, C, D, F
  scores: {
    hook:        number;
    pacing:      number;
    emotion:     number;
    clarity:     number;
    originality: number;
  };
  sceneScores: Array<{
    sceneIndex: number;
    score:      number;
    weakness?:  string;
  }>;
  suggestions:  string[];
  healthIssues: Array<{
    code:     string;
    message:  string;
    severity: 'info' | 'warning' | 'error';
  }>;
}

// ─── Health checks (no LLM, runs in <10ms) ───────────────────────────────────
function runHealthChecks(scenes: SceneInput[], totalDuration?: number): EvaluationResult['healthIssues'] {
  const issues: EvaluationResult['healthIssues'] = [];

  scenes.forEach((s) => {
    const dur     = s.audioDuration ?? 0;
    const narrLen = (s.narration ?? '').trim().split(/\s+/).filter(Boolean).length;

    if (dur > 8) {
      issues.push({
        code: 'scene_too_long',
        severity: 'warning',
        message: `Scene ${s.sceneIndex + 1} нь ${dur.toFixed(1)}с — хэт урт (>8с), анхаарал тарах эрсдэлтэй.`,
      });
    }
    if (dur > 0 && dur < 2) {
      issues.push({
        code: 'scene_too_short',
        severity: 'warning',
        message: `Scene ${s.sceneIndex + 1} нь ${dur.toFixed(1)}с — хэт богино (<2с), мэдээлэл ойлгох цаг хүрэхгүй.`,
      });
    }
    if (narrLen > 25 && dur > 0 && narrLen / Math.max(dur, 1) > 4) {
      issues.push({
        code: 'narration_too_dense',
        severity: 'warning',
        message: `Scene ${s.sceneIndex + 1}: ${narrLen} үг / ${dur.toFixed(1)}с — TTS-ийн дараа унших цаг хүрэхгүй.`,
      });
    }
    if (!s.narration || s.narration.trim().length === 0) {
      issues.push({
        code: 'empty_narration',
        severity: 'error',
        message: `Scene ${s.sceneIndex + 1}-д narration байхгүй.`,
      });
    }
    if (!s.imagePrompt || s.imagePrompt.trim().length === 0) {
      issues.push({
        code: 'empty_image_prompt',
        severity: 'error',
        message: `Scene ${s.sceneIndex + 1}-д image prompt байхгүй.`,
      });
    }
  });

  if (totalDuration && totalDuration > 60) {
    issues.push({
      code: 'duration_over_60',
      severity: 'info',
      message: `Нийт хугацаа ${totalDuration.toFixed(0)}с — TikTok/Reels-д хамгийн оновчтой нь 30–60с.`,
    });
  }
  if (scenes.length < 3) {
    issues.push({
      code: 'too_few_scenes',
      severity: 'warning',
      message: `Зөвхөн ${scenes.length} scene — динамик байдал багасна (3+ санал болгоно).`,
    });
  }
  if (scenes.length > 12) {
    issues.push({
      code: 'too_many_scenes',
      severity: 'info',
      message: `${scenes.length} scene — хэтэрхий олон, scene тус бүр богино болж байгаа эсэхийг шалга.`,
    });
  }

  return issues;
}

// ─── AI viral scoring (LLM call) ─────────────────────────────────────────────
async function callLLM(prompt: string): Promise<string> {
  // Prefer Anthropic Claude (best for structured scoring), fall back to Groq
  if (anthropic) {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-0',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = resp.content[0];
    return block.type === 'text' ? block.text : '';
  }
  if (groq) {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    return resp.choices[0]?.message?.content ?? '';
  }
  throw new Error('No LLM provider configured (Anthropic or Groq required)');
}

function scoreToGrade(s: number): string {
  if (s >= 92) return 'A+';
  if (s >= 85) return 'A';
  if (s >= 78) return 'B+';
  if (s >= 70) return 'B';
  if (s >= 60) return 'C';
  if (s >= 50) return 'D';
  return 'F';
}

function buildPrompt(topic: string, genre: string, scenes: SceneInput[]): string {
  const scriptText = scenes
    .map(s => `Scene ${s.sceneIndex + 1} [${s.time ?? '?'}] (${s.audioDuration?.toFixed(1) ?? '?'}s)\n  Visual: ${s.imagePrompt ?? ''}\n  Narration: ${s.narration ?? ''}`)
    .join('\n\n');

  return `You are an expert short-form video evaluator (TikTok / YouTube Shorts / Instagram Reels).
Rate the following script on 5 dimensions, 0–100 each. Be honest and discriminating — average viral content scores 60–75, only truly outstanding work scores 85+.

TOPIC:  ${topic}
GENRE:  ${genre}

SCRIPT:
${scriptText}

Return ONLY a JSON object in this exact shape (no markdown, no commentary):
{
  "hook":        <0-100, how strongly do the first 3 seconds grab attention>,
  "pacing":      <0-100, scene-length balance, rhythm>,
  "emotion":     <0-100, emotional impact, hooks the viewer's feelings>,
  "clarity":     <0-100, narrative coherence, easy to follow>,
  "originality": <0-100, fresh vs cliché>,
  "sceneScores": [{"sceneIndex": 0, "score": <0-100>, "weakness": "<short reason if score<70 else omit>"}, ...one entry per scene],
  "suggestions": ["<concrete improvement 1>", "<concrete improvement 2>", "<concrete improvement 3>"]
}
`.trim();
}

function safeParseJson(text: string): any {
  // Strip markdown code fences if present
  let cleaned = text.trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  // Find the first { and last } to handle leading prose
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned);
}

export async function evaluateVideo(
  topic: string,
  genre: string,
  scenes: SceneInput[],
  totalDuration?: number,
): Promise<EvaluationResult> {
  // Run health checks regardless of LLM availability
  const healthIssues = runHealthChecks(scenes, totalDuration);

  // Call LLM for viral scoring
  let scores = { hook: 70, pacing: 70, emotion: 70, clarity: 70, originality: 70 };
  let sceneScores: EvaluationResult['sceneScores'] = scenes.map(s => ({ sceneIndex: s.sceneIndex, score: 70 }));
  let suggestions: string[] = [];

  try {
    const raw    = await callLLM(buildPrompt(topic, genre, scenes));
    const parsed = safeParseJson(raw);
    scores = {
      hook:        Math.max(0, Math.min(100, Number(parsed.hook)        || 70)),
      pacing:      Math.max(0, Math.min(100, Number(parsed.pacing)      || 70)),
      emotion:     Math.max(0, Math.min(100, Number(parsed.emotion)     || 70)),
      clarity:     Math.max(0, Math.min(100, Number(parsed.clarity)     || 70)),
      originality: Math.max(0, Math.min(100, Number(parsed.originality) || 70)),
    };
    if (Array.isArray(parsed.sceneScores)) {
      sceneScores = parsed.sceneScores.map((s: any) => ({
        sceneIndex: Number(s.sceneIndex) || 0,
        score:      Math.max(0, Math.min(100, Number(s.score) || 70)),
        weakness:   typeof s.weakness === 'string' ? s.weakness : undefined,
      }));
    }
    if (Array.isArray(parsed.suggestions)) {
      suggestions = parsed.suggestions.filter((x: any) => typeof x === 'string').slice(0, 5);
    }
  } catch (err: any) {
    console.warn(`⚠️  Evaluation LLM call failed: ${err.message} — using defaults`);
    suggestions = ['Үнэлгээ хийх боломжгүй боллоо. AI үйлчилгээ дахин шалгана уу.'];
  }

  const overallScore = Math.round(
    (scores.hook + scores.pacing + scores.emotion + scores.clarity + scores.originality) / 5,
  );

  return {
    overallScore,
    grade: scoreToGrade(overallScore),
    scores,
    sceneScores,
    suggestions,
    healthIssues,
  };
}
