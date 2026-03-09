// import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
// import { config } from "../../config";
// import * as fs from "fs";



// export interface WordTiming {
//   word: string;
//   start: number;
//   end: number;
// }

// export interface SubtitleEntry {
//   index: number;
//   startTime: string;
//   endTime: string;
//   text: string;
// }

// export interface TTSWithSubtitleResult {
//   audioBuffer: Buffer;
//   duration: number;
//   words: WordTiming[];
//   subtitles: SubtitleEntry[];
//   srtContent: string;
//   vttContent: string;
// }

// // ─── Config ───────────────────────────────────────────────────────────────────

// const { ELEVENLABS_API_KEY } = config;

// // Subtitle-д хэдэн үг нэг мөрт байх
// const WORDS_PER_LINE = 5;

// // ─── Service ──────────────────────────────────────────────────────────────────

// class SubtitleService {
//   private client: ElevenLabsClient;

//   constructor() {
//     this.client = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });
//   }

//   // ─── Main: narration текст → audio + subtitle ─────────────────────────────
//   // ElevenLabs with_timestamps=true дуудахад alignment дотор
//   // character-level timing ирнэ → үүнийг word-level болгоно

//   async textToSpeechWithSubtitles(
//     narration: string,
//     voiceId: string = "21m00Tcm4TlvDq8ikWAM",
//     opts: { speed?: number; pitch?: number } = {}
//   ): Promise<TTSWithSubtitleResult> {
//     try {
//       // ElevenLabs: with_timestamps=true → alignment object буцаана
//       const response = await this.client.textToSpeech.convertWithTimestamps(
//         voiceId,
//         {
//           text: narration,
//           model_id: "eleven_multilingual_v2",
//           voice_settings: {
//             stability: 0.5,
//             similarity_boost: 0.75,
//             speed: opts.speed ?? 1.0,
//           },
//         }
//       );

//       // audio_base64 → Buffer
//       const audioBuffer = Buffer.from(response.audio_base64 ?? "", "base64");

//       // alignment → WordTiming[]
//       const words = this.alignmentToWords(
//         narration,
//         response.alignment ?? response.normalized_alignment
//       );

//       const duration =
//         words.length > 0 ? words[words.length - 1].end : audioBuffer.length / 16000;

//       // WordTiming[] → SubtitleEntry[]
//       const subtitles = this.buildSubtitles(words);
//       const srtContent = this.toSRT(subtitles);
//       const vttContent = this.toVTT(subtitles);

//       return { audioBuffer, duration, words, subtitles, srtContent, vttContent };
//     } catch (err: any) {
//       console.error("❌ textToSpeechWithSubtitles failed:", err.message);
//       throw err;
//     }
//   }

//   // ─── Multi-scene: бүх scene-д зэрэг дуудна ─────────────────────────────────

//   async generateScenesWithSubtitles(
//     scenes: { narration: string; voiceId?: string }[]
//   ): Promise<TTSWithSubtitleResult[]> {
//     const results: TTSWithSubtitleResult[] = [];

//     for (let i = 0; i < scenes.length; i++) {
//       const { narration, voiceId } = scenes[i];
//       console.log(`  [${i + 1}/${scenes.length}] TTS + subtitle: "${narration.slice(0, 40)}..."`);

//       try {
//         const result = await this.textToSpeechWithSubtitles(narration, voiceId);
//         results.push(result);
//         console.log(`    ✓ ${result.words.length} үг, ${result.duration.toFixed(2)}s`);
//       } catch (err: any) {
//         console.error(`    ✗ Scene ${i + 1} failed: ${err.message}`);
//         // Алдаатай scene-д хоосон утга нэмнэ
//         results.push(this.emptyResult());
//       }
//     }

//     return results;
//   }

//   // ─── Нэгдсэн SRT үүсгэх (бүх scene нэг SRT файлд) ──────────────────────────

//   mergeSubtitles(
//     sceneResults: TTSWithSubtitleResult[],
//     sceneDurations: number[]
//   ): { srtContent: string; vttContent: string; allWords: WordTiming[] } {
//     const allWords: WordTiming[] = [];
//     let timeOffset = 0;

//     sceneResults.forEach((result, i) => {
//       // Time offset-оор word timing-ийг шилжүүлнэ
//       result.words.forEach((w) => {
//         allWords.push({
//           word: w.word,
//           start: w.start + timeOffset,
//           end: w.end + timeOffset,
//         });
//       });

//       // Дараагийн scene-ийн эхлэх цаг
//       timeOffset += sceneDurations[i] ?? result.duration;
//     });

//     const subtitles = this.buildSubtitles(allWords);

//     return {
//       srtContent: this.toSRT(subtitles),
//       vttContent: this.toVTT(subtitles),
//       allWords,
//     };
//   }

//   // ─── SRT / VTT файлд хадгалах ────────────────────────────────────────────

//   saveSRT(content: string, outputPath: string): void {
//     fs.writeFileSync(outputPath, content, "utf-8");
//     console.log(`✅ SRT хадгалагдлаа: ${outputPath}`);
//   }

//   saveVTT(content: string, outputPath: string): void {
//     fs.writeFileSync(outputPath, content, "utf-8");
//     console.log(`✅ VTT хадгалагдлаа: ${outputPath}`);
//   }

//   // ─── ElevenLabs alignment → WordTiming[] ────────────────────────────────────
//   // ElevenLabs character-level timing өгдөг тул
//   // space-аар хуваан word болгоно

//   private alignmentToWords(
//     _narration: string,
//     alignment: any
//   ): WordTiming[] {
//     if (!alignment) return [];

//     const chars: string[] = alignment.characters ?? [];
//     const starts: number[] = alignment.character_start_times_seconds ?? [];
//     const ends: number[] = alignment.character_end_times_seconds ?? [];

//     const words: WordTiming[] = [];
//     let currentWord = "";
//     let wordStart = 0;
//     let wordEnd = 0;

//     for (let i = 0; i < chars.length; i++) {
//       const ch = chars[i];

//       if (ch === " " || ch === "\n") {
//         // Space → өмнөх word-ийг хаана
//         if (currentWord.trim()) {
//           words.push({ word: currentWord.trim(), start: wordStart, end: wordEnd });
//         }
//         currentWord = "";
//       } else {
//         if (!currentWord) {
//           wordStart = starts[i] ?? 0;
//         }
//         currentWord += ch;
//         wordEnd = ends[i] ?? starts[i] ?? 0;
//       }
//     }

//     // Сүүлийн үг
//     if (currentWord.trim()) {
//       words.push({ word: currentWord.trim(), start: wordStart, end: wordEnd });
//     }

//     return words;
//   }

//   // ─── WordTiming[] → SubtitleEntry[] ─────────────────────────────────────────

//   private buildSubtitles(words: WordTiming[]): SubtitleEntry[] {
//     const entries: SubtitleEntry[] = [];
//     let index = 1;

//     for (let i = 0; i < words.length; i += WORDS_PER_LINE) {
//       const chunk = words.slice(i, i + WORDS_PER_LINE);
//       if (!chunk.length) continue;

//       entries.push({
//         index,
//         startTime: this.toSRTTime(chunk[0].start),
//         endTime: this.toSRTTime(chunk[chunk.length - 1].end),
//         text: chunk.map((w) => w.word).join(" "),
//       });
//       index++;
//     }

//     return entries;
//   }

//   // ─── Format helpers ───────────────────────────────────────────────────────

//   private toSRTTime(sec: number): string {
//     const h = Math.floor(sec / 3600);
//     const m = Math.floor((sec % 3600) / 60);
//     const s = Math.floor(sec % 60);
//     const ms = Math.round((sec % 1) * 1000);
//     return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
//   }

//   private toVTTTime(sec: number): string {
//     return this.toSRTTime(sec).replace(",", ".");
//   }

//   private toSRT(entries: SubtitleEntry[]): string {
//     return entries
//       .map((e) => `${e.index}\n${e.startTime} --> ${e.endTime}\n${e.text}\n`)
//       .join("\n");
//   }

//   private toVTT(entries: SubtitleEntry[]): string {
//     const body = entries
//       .map((e) => `${this.toVTTTime(this.srtToSec(e.startTime))} --> ${this.toVTTTime(this.srtToSec(e.endTime))}\n${e.text}`)
//       .join("\n\n");
//     return `WEBVTT\n\n${body}`;
//   }

//   private srtToSec(srt: string): number {
//     const [hms, ms] = srt.split(",");
//     const [h, m, s] = hms.split(":").map(Number);
//     return h * 3600 + m * 60 + s + Number(ms) / 1000;
//   }

//   private emptyResult(): TTSWithSubtitleResult {
//     return {
//       audioBuffer: Buffer.alloc(0),
//       duration: 0,
//       words: [],
//       subtitles: [],
//       srtContent: "",
//       vttContent: "",
//     };
//   }
// }

// function pad(n: number, len = 2): string {
//   return String(n).padStart(len, "0");
// }

// export default new SubtitleService();