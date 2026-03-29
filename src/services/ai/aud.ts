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
}

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

      return { audioBuffer, format: 'wav', duration };

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

      const prompt = `Say in Mongolian: ${text}`;

      const GEMINI_VOICES = ['Kore','Aoede','Charon','Fenrir','Puck','Orbit',
                             'Schedar','Alya','Despina','Erinome','Gacrux'];

      const voiceName = GEMINI_VOICES.includes(options?.voice_name ?? '')
        ? options!.voice_name!
        : 'Kore';

      console.log(`Using Gemini voice: ${voiceName}`);

      const response = await this.geminiTts.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{parts: [{text: prompt}]}],
        config: {
          responseModalities: ['AUDIO'],
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
      const words = this.estimateWordTimings(text, duration);
      
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

  // ─── Cleaning ─────────────────────────────────────────────────────────────

  private cleanTextForChimege(text: string): string {
    let cleaned = text;
    cleaned = cleaned.normalize('NFC');
    cleaned = cleaned.trim().replace(/\s+/g, ' ');
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

    cloudinary.config({
      cloud_name: CLOUDNAME,
      api_key: CLOUD_API_KEY,
      api_secret: CLOUD_API_SECRET
    });

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