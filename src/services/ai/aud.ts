import axios from 'axios';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { config } from '../../config';
import { GoogleGenAI } from '@google/genai';


const { CHIMEGE_VOICE_API, CLOUDNAME, CLOUD_API_KEY, CLOUD_API_SECRET, ELEVENLABS_API_KEY } = config;

interface AudioGenerationResult {
  audioBuffer: Buffer;
  audioUrl?: string;
  duration?: number;
  format: string;
  words?: WordTiming[];
}

export interface WordTiming {
  word: string;
  start: number; 
  end: number;  
}

interface ChimegeOptions {
  voice_id?: string;
  speed?: number;
  pitch?: number;
  sample_rate?: number;
}

interface GeminiTtsOptions {
  voice_name?: string;
  speed?: number;
  pitch?: number;
  sample_rate?: number;
  /** Genre slug — used to pick voice + delivery style. Matches frontend GENRES list. */
  genre?: string;
  /** Source language — affects the "Read in X" instruction. */
  language?: 'mongolian' | 'english';
  /** Override prompt entirely (advanced). If set, ignores genre/language style mapping. */
  customPrompt?: string;
  /** Override LLM temperature for expressiveness (0.7-1.2 range works well). */
  temperature?: number;
}

// ─── Genre → delivery style (Gemini TTS prompt fragment) ──────────────────────
// Gemini TTS бол LLM-based — promt-нд "ямар өнгөөр уншихыг" зааж өгснөөр
// дуу гарах мэдрэмж эрс өөрчлөгддөг. Default нь хэт flat учир genre-aware
// styling нь хамгийн их impact-тай tweak.
const GEMINI_STYLE_BY_GENRE: Record<string, string> = {
  scary:         'in a low, ominous whisper with dramatic pauses, building tension and dread',
  trueCrime:     'in a serious, investigative documentary tone — slow, deliberate, weighty',
  conspiracy:    'in a hushed, secretive tone, as if revealing forbidden knowledge',
  darkHistory:   'in a grave, somber storytelling voice with measured, deliberate pacing',
  psychology:    'in a calm, thoughtful, intimate tone — like a TED talk speaker',
  mythology:     'in an epic, theatrical storytelling voice, like an ancient bard reciting a legend',
  stoic:         'in a slow, wise, contemplative tone with gravitas and quiet authority',
  mythBusting:   'in a confident, slightly playful tone — debunking myths with energy and wit',
  survival:      'in an urgent, intense tone — life-or-death narration with rising tension',
  futuristic:    'in a crisp, slightly mechanical but engaging tone — sci-fi documentary style',
  biography:     'in a warm, reverent storytelling voice with genuine admiration',
  shockingFacts: 'in an excited, surprised tone — pulling the listener in with every fact',
  business:      'in a clear, confident, podcast-host tone — authoritative but conversational',
  sciExplained:  'in a curious, enthusiastic teacher tone — like an engaging science YouTuber',
  education:     'in a clear, engaging instructor tone — friendly but authoritative',
};

// ─── Genre → voice preset ─────────────────────────────────────────────────────
// Gemini-ийн pre-built voices бүр өөр timbre/gender-тэй. Genre-тэй
// тааруулж өгснөөр default "Kore" гэдэг neutral дуунаас илт сайжирна.
const GEMINI_VOICE_BY_GENRE: Record<string, string> = {
  scary:         'Charon',   // deep, ominous
  darkHistory:   'Charon',
  conspiracy:    'Charon',
  trueCrime:     'Fenrir',   // intense male
  survival:      'Fenrir',
  mythology:     'Aoede',    // warm storyteller
  biography:     'Aoede',
  shockingFacts: 'Puck',     // energetic
  mythBusting:   'Puck',
  stoic:         'Schedar',  // calm, wise
  psychology:    'Schedar',
  futuristic:    'Orbit',
  sciExplained:  'Despina',
  education:     'Kore',
  business:      'Kore',
};

const WORDS_PER_LINE = 1; 

class AudioService {
  private apiUrl: string;
  private chimege: string;
  private elevenLab: ElevenLabsClient;
  private geminiTts: GoogleGenAI;

  constructor() {
    this.apiUrl = 'https://api.chimege.com/v1.2/synthesize';
    this.chimege = CHIMEGE_VOICE_API;
    this.elevenLab = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });
    this.geminiTts = new GoogleGenAI({});
    
  }


  async textToSpeechChimege(
    text: string,
    options?: ChimegeOptions
  ): Promise<AudioGenerationResult> {
    try {
      const cleanedText = this.cleanTextForChimege(text);
  
      console.log('\n=== CHIMEGE TTS REQUEST ===');
      console.log('Original text:', text.substring(0, 100));
      console.log('Cleaned text:', cleanedText.substring(0, 100));
      console.log('Text length:', cleanedText.length);
      
      const forbiddenChars = cleanedText.match(/[^А-ЯЁа-яёӨөҮүҢң\s?!.\-'":,]/g);
      if (forbiddenChars) {
        console.error('Forbidden characters found:', forbiddenChars);
        throw new Error(`Text contains forbidden characters: ${forbiddenChars.join(', ')}`);
      }
  
      const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'token': this.chimege,
        'voice-id': options?.voice_id || 'FEMALE3v2',
        'speed': String(options?.speed || 1.0),
        'pitch': String(options?.pitch || 1.0),
        'sample-rate': String(options?.sample_rate || 22050)
      };
  
      console.log('Request headers:', {
        'voice-id': headers['voice-id'],
        'speed': headers['speed'],
        'pitch': headers['pitch'],
        'sample-rate': headers['sample-rate'],
        'token': this.chimege ? '***' + this.chimege.slice(-4) : 'MISSING'
      });
  
      console.log('Sending request to:', this.apiUrl);
  
      const response = await axios.post(
        this.apiUrl,
        cleanedText,
        {
          headers,
          responseType: 'arraybuffer',
          timeout: 60000,
          validateStatus: (status) => status < 500 
        }
      );
  
      if (response.status !== 200) {
        const errorText = Buffer.from(response.data).toString('utf-8');
        console.error('API Error Response:', errorText);
        throw new Error(`API returned status ${response.status}: ${errorText}`);
      }
  
      const audioBuffer = Buffer.from(response.data);
  
      if (audioBuffer.length < 100) {
        const possibleError = audioBuffer.toString('utf-8');
        console.error('Response too small, might be error:', possibleError);
        throw new Error('Invalid audio response from API');
      }
  
      console.log(`Audio generated successfully`);
      console.log(`   Size: ${audioBuffer.length} bytes`);
      console.log(`   Format: WAV`);
  
      let duration: number | undefined;
      try {
        const byteRate = audioBuffer.readUInt32LE(28);
        duration = parseFloat(((audioBuffer.length - 44) / byteRate).toFixed(2));
        console.log(`   Duration: ${duration}s`);
      } catch { duration = undefined; }

      const words = duration ? this.estimateWordTimings(text, duration) : [];

      return { audioBuffer, format: 'wav', duration, words };

    } catch (error: any) {
      console.error('\n CHIMEGE TTS ERROR:', error.message);
      
      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data;
        if (errorData instanceof Buffer) {
          const errorMessage = errorData.toString('utf-8');
          console.error('Error details:', errorMessage);
          throw new Error(`Audio generation failed: ${errorMessage}`);
        }
        console.error('Error status:', error.response?.status);
        console.error('Error headers:', error.response?.headers);
        console.error('Error data:', errorData);
        throw new Error(`Audio generation failed: ${errorData || error.message}`);
      }
      
      throw new Error(`Audio generation failed: ${error.message}`);
    }
  }


  async textToSpeechGemini(text: string, options?: GeminiTtsOptions): Promise<AudioGenerationResult> {
    try {
      console.log("\n=== GEMINI TTS + TIMESTAMPS ===");
      console.log("Text:", text.substring(0, 100));

      const GEMINI_VOICES = ['Kore','Aoede','Charon','Fenrir','Puck','Orbit',
                             'Schedar','Alya','Despina','Erinome','Gacrux'];

      // ── Voice selection priority: explicit > genre-map > default ─────────
      const explicitVoice = options?.voice_name && GEMINI_VOICES.includes(options.voice_name)
        ? options.voice_name
        : null;
      const genreVoice = options?.genre ? GEMINI_VOICE_BY_GENRE[options.genre] : null;
      const voiceName = explicitVoice ?? genreVoice ?? 'Kore';

      // ── Build expressive, genre-aware prompt ─────────────────────────────
      // Gemini TTS-ийн дуу муу гарах гол шалтгаан нь "Say in Mongolian: ..."
      // гэх мэт flat instruction. Доорх prompt нь хэв маяг, мэдрэмж, хурдыг
      // тодорхой зааж өгнө — энэ нь дуу чанарт хамгийн их нөлөөлдөг tweak.
      const language = options?.language ?? 'mongolian';
      const langLabel = language === 'mongolian' ? 'in Mongolian' : 'in English';
      const styleHint = (options?.genre && GEMINI_STYLE_BY_GENRE[options.genre])
        || 'in an engaging, expressive storytelling voice with natural emotion, appropriate pauses, and clear emphasis on key words';

      // Тоонуудыг хэлэнд тохирох үсгээр уг гаргаж бичих —
      // Gemini монгол текст дунд тоонуудыг англиар уншиж нийцгүй сонсогддог.
      const ttsText = this.spellOutNumbers(text, language);

      const prompt = options?.customPrompt ?? [
        `Read the following text aloud ${langLabel} ${styleHint}.`,
        `Speak naturally and expressively, like a professional voice actor narrating viral short-form video content.`,
        `Vary your pace and intonation to match the emotional tone of each sentence.`,
        `Read all numbers, dates, and quantities naturally as full words in ${language === 'mongolian' ? 'Mongolian' : 'English'} — never spell them digit-by-digit.`,
        `Do NOT add any extra commentary, intro, outro, or sound effects — only read the text exactly as written.`,
        ``,
        `TEXT TO READ:`,
        ttsText,
      ].join('\n');

      console.log(`Using Gemini voice: ${voiceName} (genre=${options?.genre ?? 'none'}, lang=${language})`);

      const response = await this.geminiTts.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{parts: [{text: prompt}]}],
        config: {
          responseModalities: ['AUDIO'],
          temperature: options?.temperature ?? 1.0,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        } as any,
      });

      // ── Extract raw PCM bytes ──────────────────────────────────────────────
      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inlineData?.data) {
        throw new Error('Gemini TTS returned no audio data');
      }
      
      const pcmBuffer = Buffer.from(inlineData.data, 'base64');
      
      if (pcmBuffer.length < 100) {
        throw new Error('Invalid audio response from Gemini TTS');
      }
      
      const SAMPLE_RATE     = 24_000;
      const NUM_CHANNELS    = 1;
      const BITS_PER_SAMPLE = 16;
      
      const audioBuffer = this.pcmToWav(pcmBuffer, SAMPLE_RATE, NUM_CHANNELS, BITS_PER_SAMPLE);
      
      // ── Duration ──────────────────────────────────────────────────────────
      const numSamples = pcmBuffer.length / (BITS_PER_SAMPLE / 8);
      const duration   = parseFloat((numSamples / SAMPLE_RATE).toFixed(2));
      
      // ── Word timings (estimated — Gemini TTS doesn't return alignment) ────
      // ttsText-г ашиглах нь чухал: тоонуудыг үсгээр болгож сольсон тул
      // субтитрт орох үг = яг уншигдсан үгтэй таарна.
      const words = this.estimateWordTimings(ttsText, duration);
      
      console.log(`   PCM size : ${pcmBuffer.length} bytes → WAV: ${audioBuffer.length} bytes`);
      console.log(`   Duration : ${duration.toFixed(2)}s`);
      console.log(`   Words est: ${words.length}`);
      
      return { audioBuffer, format: 'wav', duration, words };
      
    } catch (err: any) {
      console.error('\nGemini TTS ERROR:', err.message);
      throw new Error(`Audio generation failed: ${err.message}`);
    }
  }
  async textToSpeechEleven(
    text: string,
    options?: ChimegeOptions
  ): Promise<AudioGenerationResult> {
    try {
      console.log("\n=== ELEVENLABS TTS + TIMESTAMPS ===");
      console.log("Text:", text.substring(0, 100));
      const selectedVoiceId = options?.voice_id || 'fBD19tfE58bkETeiwUoC';

      console.log(`using voice Id: ${selectedVoiceId}`)

      const response = await this.elevenLab.textToSpeech.convertWithTimestamps(
        selectedVoiceId,
        {
          text,
          modelId: 'eleven_multilingual_v2',
          outputFormat: 'mp3_44100_128',
        }
      );

      // audio_base64 → Buffer
      const audioBuffer = Buffer.from(response.audioBase64 ?? '', 'base64');

      if (audioBuffer.length < 100) {
        throw new Error('Invalid audio response from ElevenLabs');
      }

      // alignment → WordTiming[]
      const words = this.alignmentToWords(
        response.alignment ?? (response as any).normalized_alignment
      );


      const duration = words.length > 0
        ? words[words.length - 1].end
        : parseFloat(((audioBuffer.length * 8) / (128 * 1000)).toFixed(2));

      console.log(`   Size: ${audioBuffer.length} bytes`);
      console.log(`   Duration: ${duration.toFixed(2)}s`);
      console.log(`   Words with timing: ${words.length}`);

      return { audioBuffer, format: 'mp3', duration, words };

    } catch (error: any) {
      console.error('\nElevenLabs TTS ERROR:', error.message);
      throw new Error(`Audio generation failed: ${error.message}`);
    }
  }

  // ─── Raw PCM → WAV (44-byte header) ──────────────────────────────────────
  private pcmToWav(
    pcm: Buffer,
    sampleRate: number,
    numChannels: number,
    bitsPerSample: number,
  ): Buffer {
    const byteRate   = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize   = pcm.length;
    const header     = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);              // fmt chunk size
    header.writeUInt16LE(1, 20);               // AudioFormat = PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcm]);
  }

  // ─── Proportional word-timing estimator ──────────────────────────────────
  // Gemini TTS alignment буцаадаггүй тул үгийн урттай пропорциональаар хуваарилна.
  private estimateWordTimings(text: string, totalDuration: number): WordTiming[] {
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    if (!words.length || totalDuration <= 0) return [];

    const totalChars = words.reduce((sum, w) => sum + w.length, 0);
    const timings: WordTiming[] = [];
    let cursor = 0;

    for (const word of words) {
      const wordDur = (word.length / totalChars) * totalDuration;
      timings.push({
        word,
        start: parseFloat(cursor.toFixed(3)),
        end:   parseFloat((cursor + wordDur).toFixed(3)),
      });
      cursor += wordDur;
    }

    return timings;
  }


  // ─── ElevenLabs alignment → WordTiming[] ─────────────────────────────────
  // ElevenLabs character-level timing өгдөг:
  //   alignment.characters[]
  //   alignment.character_start_times_seconds[]
  //   alignment.character_end_times_seconds[]
  // → space-аар хуваан word болгоно

  private alignmentToWords(alignment: any): WordTiming[] {
    if (!alignment) return [];

    const chars: string[]   = alignment.characters ?? [];
    // ElevenLabs JS SDK may return camelCase or snake_case depending on version
    const starts: number[]  =
      alignment.character_start_times_seconds ??
      alignment.characterStartTimesSeconds ?? [];
    const ends: number[]    =
      alignment.character_end_times_seconds ??
      alignment.characterEndTimesSeconds ?? [];

    const words: WordTiming[] = [];
    let currentWord = '';
    let wordStart   = 0;
    let wordEnd     = 0;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];

      if (ch === ' ' || ch === '\n') {
        if (currentWord.trim()) {
          words.push({ word: currentWord.trim(), start: wordStart, end: wordEnd });
        }
        currentWord = '';
      } else {
        if (!currentWord) wordStart = starts[i] ?? 0;
        currentWord += ch;
        wordEnd = ends[i] ?? starts[i] ?? 0;
      }
    }

    // Сүүлийн үг
    if (currentWord.trim()) {
      words.push({ word: currentWord.trim(), start: wordStart, end: wordEnd });
    }

    return words;
  }

  // ─── WordTiming[] → SRT string ────────────────────────────────────────────

  wordsToSRT(words: WordTiming[], timeOffset = 0): string {
    const entries: string[] = [];
    let index = 1;

    for (let i = 0; i < words.length; i += WORDS_PER_LINE) {
      const chunk = words.slice(i, i + WORDS_PER_LINE);
      if (!chunk.length) continue;

      const start = this.toSRTTime(chunk[0].start + timeOffset);
      const end   = this.toSRTTime(chunk[chunk.length - 1].end + timeOffset);
      const text  = chunk.map((w) => w.word).join(' ');

      entries.push(`${index}\n${start} --> ${end}\n${text}`);
      index++;
    }

    return entries.join('\n\n');
  }

  private toSRTTime(sec: number): string {
    const h  = Math.floor(sec / 3600);
    const m  = Math.floor((sec % 3600) / 60);
    const s  = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
  }

  // ─── Number-to-Mongolian-words ────────────────────────────────────────────
  // Chimege-ийн regex тоо stripт хаядаг, Gemini-ийн TTS заримдаа тоог
  // англиар уншдаг. Тиймээс TTS-руу явахаас ӨМНӨ бүх тоог монгол үсгээр
  // уг гаргаж бичнэ — жиш. "1959 онд" → "нэг мянга есөн зуун тавин ес онд".
  private readonly mnDigits     = ['тэг','нэг','хоёр','гурав','дөрөв','тав','зургаа','долоо','найм','ес'];
  // Compounding form used BEFORE зуун/мянга/сая/тэрбум — e.g. "есөн зуун"
  // (not "ес зуун"), "гурван мянга" (not "гурав мянга").
  private readonly mnDigitsBeforeUnit = ['','нэг','хоёр','гурван','дөрвөн','таван','зургаан','долоон','найман','есөн'];
  private readonly mnTensSolo   = ['','арав','хорь','гуч','дөч','тавь','жар','дал','ная','ер'];
  private readonly mnTensCombo  = ['','арван','хорин','гучин','дөчин','тавин','жаран','далан','наян','ерэн'];

  private numberToMongolian(n: number): string {
    if (!isFinite(n)) return '';
    if (n < 0) return 'хасах ' + this.numberToMongolian(-n);
    if (n === 0) return 'тэг';

    if (n < 10) return this.mnDigits[n];

    if (n < 100) {
      const t = Math.floor(n / 10);
      const u = n % 10;
      return u === 0 ? this.mnTensSolo[t] : `${this.mnTensCombo[t]} ${this.mnDigits[u]}`;
    }

    if (n < 1000) {
      const h    = Math.floor(n / 100);
      const rest = n % 100;
      // Single-digit hundreds use compound form: "есөн зуун", "гурван зуун".
      const hWord = `${this.mnDigitsBeforeUnit[h]} зуун`;
      if (rest === 0) return hWord.replace(/ зуун$/, ' зуу');
      return `${hWord} ${this.numberToMongolian(rest)}`;
    }

    if (n < 1_000_000) {
      const th   = Math.floor(n / 1000);
      const rest = n % 1000;
      // Multi-digit thousands → recurse; single-digit uses compound form.
      const thWord = th < 10
        ? `${this.mnDigitsBeforeUnit[th]} мянга`
        : `${this.numberToMongolian(th)} мянга`;
      return rest === 0 ? thWord : `${thWord} ${this.numberToMongolian(rest)}`;
    }

    if (n < 1_000_000_000) {
      const m    = Math.floor(n / 1_000_000);
      const rest = n % 1_000_000;
      const mWord = m < 10
        ? `${this.mnDigitsBeforeUnit[m]} сая`
        : `${this.numberToMongolian(m)} сая`;
      return rest === 0 ? mWord : `${mWord} ${this.numberToMongolian(rest)}`;
    }

    if (n < 1_000_000_000_000) {
      const b    = Math.floor(n / 1_000_000_000);
      const rest = n % 1_000_000_000;
      const bWord = b < 10
        ? `${this.mnDigitsBeforeUnit[b]} тэрбум`
        : `${this.numberToMongolian(b)} тэрбум`;
      return rest === 0 ? bWord : `${bWord} ${this.numberToMongolian(rest)}`;
    }

    // Trillion+ : digit-by-digit fallback
    return String(n).split('').map(d => this.mnDigits[+d] || d).join(' ');
  }

  /**
   * Convert digits embedded in text to spelled-out Mongolian (or leave intact
   * for English). Handles:
   *   - thousands separators (1,000 / 1.000 — locale-aware-ish)
   *   - percent (50% → "тавин хувь")
   *   - currency ($50 → "тавин доллар", ₮50 → "тавин төгрөг")
   *   - decimals (3.14 → "гурав цэг арван дөрөв")
   */
  private spellOutNumbers(text: string, language: 'mongolian' | 'english' = 'mongolian'): string {
    if (language !== 'mongolian') return text; // Gemini reads English digits OK

    let out = text;

    // Currency prefixes first ($50, ₮50) — replace prefix with suffix word.
    out = out.replace(/\$(\d[\d,]*(?:\.\d+)?)/g, (_m, num) => `${num} доллар`);
    out = out.replace(/₮(\d[\d,]*(?:\.\d+)?)/g, (_m, num) => `${num} төгрөг`);

    // Decimals: 3.14 → "гурав цэг арван дөрөв"
    out = out.replace(/(\d+)\.(\d+)/g, (_m, intPart, fracPart) => {
      const i = parseInt(intPart, 10);
      const f = parseInt(fracPart, 10);
      if (isNaN(i) || isNaN(f)) return _m;
      return `${this.numberToMongolian(i)} цэг ${this.numberToMongolian(f)}`;
    });

    // Integers with optional thousands separators (1,000 / 1 000)
    out = out.replace(/\d{1,3}(?:[,\s]\d{3})+|\d+/g, (m) => {
      const clean = m.replace(/[,\s]/g, '');
      const n = parseInt(clean, 10);
      if (isNaN(n)) return m;
      return this.numberToMongolian(n);
    });

    // Percent suffix: "X хувь" if "X%"
    out = out.replace(/([а-яёөүң]+)\s*%/gi, '$1 хувь');

    return out;
  }

  // ─── Cleaning ─────────────────────────────────────────────────────────────

  private cleanTextForChimege(text: string): string {
    let cleaned = text;
    cleaned = cleaned.normalize('NFC');
    cleaned = cleaned.trim().replace(/\s+/g, ' ');
    // Тоонуудыг үсгээр уг гаргаж бичих — доорх regex digits-ийг хайчилна.
    cleaned = this.spellOutNumbers(cleaned, 'mongolian');
    cleaned = cleaned.replace(/[^А-ЯЁа-яёӨөҮүҢң\s?!.\-'":,]/g, '');
    cleaned = cleaned.replace(/[«»""'']/g, '"');
    cleaned = cleaned.replace(/[‚„]/g, "'");
    cleaned = cleaned.replace(/([?!.,:])\1+/g, '$1');
    cleaned = cleaned.replace(/\s+([?!.,:])/g, '$1');
    cleaned = cleaned.replace(/([?!.,:])\s*/g, '$1 ');
    cleaned = cleaned.replace(/^[?!.,:\-\s]+|[?!.,:\-\s]+$/g, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (!cleaned || cleaned.length === 0) {
      console.warn('text became empty after cleaning. Original:', text);
      return 'Текст хоосон байна.';
    }

    const forbiddenChars = cleaned.match(/[^А-ЯЁа-яёӨөҮүҢң\s?!.\-'":,]/g);
    if (forbiddenChars) {
      console.warn('Forbidden characters found:', forbiddenChars.map(c =>
        `"${c}" (U+${c.charCodeAt(0).toString(16).toUpperCase()})`
      ).join(', '));
    }

    return cleaned;
  }

  async testCleaning(text: string): Promise<string> {
    console.log('=== CLEANING TEST ===');
    console.log('Original:', text);
    const cleaned = this.cleanTextForChimege(text);
    console.log('Cleaned:', cleaned);
    return cleaned;
  }

  // ─── Chimege chunk generation ─────────────────────────────────────────────

  async generateFromScript(
    narration: string,
    options?: ChimegeOptions
  ): Promise<AudioGenerationResult> {
    try {
      const chunks = this.splitTextIntoChunks(narration, 500);

      if (chunks.length === 1) {
        return await this.textToSpeechChimege(chunks[0], options);
      }

      const audioBuffers: Buffer[] = [];

      for (let i = 0; i < chunks.length; i++) {
        console.log(`Generating audio chunk ${i + 1}/${chunks.length}...`);
        const result = await this.textToSpeechChimege(chunks[i], options);
        audioBuffers.push(result.audioBuffer);
        if (i < chunks.length - 1) await this.delay(1000);
      }

      return { audioBuffer: Buffer.concat(audioBuffers), format: 'wav' };

    } catch (error: any) {
      console.error('Script audio generation error:', error);
      throw error;
    }
  }

  private splitTextIntoChunks(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    let currentChunk = '';

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();

      if ((currentChunk + trimmedSentence).length > maxLength) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }

        if (trimmedSentence.length > maxLength) {
          const words = trimmedSentence.split(' ');
          let wordChunk = '';
          for (const word of words) {
            if ((wordChunk + word).length > maxLength) {
              chunks.push(wordChunk.trim());
              wordChunk = '';
            }
            wordChunk += word + ' ';
          }
          if (wordChunk.trim().length > 0) currentChunk = wordChunk;
        } else {
          currentChunk = trimmedSentence + '. ';
        }
      } else {
        currentChunk += trimmedSentence + '. ';
      }
    }

    if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
    return chunks;
  }

  // ─── Cloudinary upload ────────────────────────────────────────────────────

  async uploadToCloudinary(audioBuffer: Buffer, filename: string): Promise<string> {
    const cloudinary = require('cloudinary').v2;

    // Always override — system env CLOUDINARY_CLOUD_NAME can shadow .env values
    cloudinary.config({
      cloud_name: CLOUDNAME   || '',
      api_key:    CLOUD_API_KEY    || '',
      api_secret: CLOUD_API_SECRET || '',
    });

    if (!CLOUDNAME) throw new Error(`Invalid cloud_name: CLOUDNAME env var is empty`);

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          folder: 'audio',
          public_id: filename.replace('.wav', ''),
          format: 'wav'
        },
        (error: any, result: any) => {
          if (error) reject(error);
          else resolve(result.secure_url);
        }
      );
      uploadStream.end(audioBuffer);
    });
  }

  // ─── Retry wrapper ────────────────────────────────────────────────────────

  async generateWithRetry(
    text: string,
    options?: ChimegeOptions,
    maxRetries: number = 3
  ): Promise<AudioGenerationResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Audio generation attempt ${attempt}/${maxRetries}...`);
        return await this.textToSpeechChimege(text, options);
      } catch (error: any) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message);

        if (error.response?.status === 429 && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`Rate limited. Waiting ${waitTime}ms...`);
          await this.delay(waitTime);
          continue;
        }

        if (attempt === maxRetries) break;
        await this.delay(1000);
      }
    }

    throw new Error(`Audio generation failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

export default new AudioService();