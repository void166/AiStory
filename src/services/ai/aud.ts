// services/ai/audioService.ts
import axios from 'axios';
import { config } from '../../config';

const { CHIMEGE_VOICE_API, CLOUDNAME, CLOUD_API_KEY, CLOUD_API_SECRET } = config;

interface AudioGenerationResult {
  audioBuffer: Buffer;
  audioUrl?: string;
  duration?: number;
  format: string;
}

interface ChimegeOptions {
  voice_id?: string;
  speed?: number;
  pitch?: number;
  sample_rate?: number;
}

class AudioService {
  private apiUrl: string;
  private apiToken: string;

  constructor() {
    this.apiUrl = 'https://api.chimege.com/v1.2/synthesize';
    this.apiToken = CHIMEGE_VOICE_API || '';
  }

async textToSpeech(
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
        console.error('❌ Forbidden characters found:', forbiddenChars);
        throw new Error(`Text contains forbidden characters: ${forbiddenChars.join(', ')}`);
      }
  
      const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'token': this.apiToken,
        'voice-id': options?.voice_id || 'MALE1',
        'speed': String(options?.speed || 1.0),
        'pitch': String(options?.pitch || 1.0),
        'sample-rate': String(options?.sample_rate || 22050)
      };
  
      console.log('Request headers:', {
        'voice-id': headers['voice-id'],
        'speed': headers['speed'],
        'pitch': headers['pitch'],
        'sample-rate': headers['sample-rate'],
        'token': this.apiToken ? '***' + this.apiToken.slice(-4) : 'MISSING'
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
  
      return {
        audioBuffer,
        format: 'wav',
        duration: undefined
      };
  
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

private cleanTextForChimege(text: string): string {
    let cleaned = text;
  
    cleaned = cleaned.normalize('NFC');

    cleaned = cleaned.trim().replace(/\s+/g, ' ');
  
    cleaned = cleaned.replace(
      /[^А-ЯЁа-яёӨөҮүҢң\s?!.\-'":,]/g, 
      ''
    );
    cleaned = cleaned.replace(/[«»""'']/g, '"'); 
    cleaned = cleaned.replace(/[‚„]/g, "'");      
  
    cleaned = cleaned.replace(/([?!.,:])\1+/g, '$1');
  
    cleaned = cleaned.replace(/\s+([?!.,:])/g, '$1');
    cleaned = cleaned.replace(/([?!.,:])\s*/g, '$1 ');
  
    cleaned = cleaned.replace(/^[?!.,:\-\s]+|[?!.,:\-\s]+$/g, '');
  

    cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
    if (!cleaned || cleaned.length === 0) {
      console.warn('⚠️ Text became empty after cleaning. Original:', text);
      return 'Текст хоосон байна.';
    }
  
    const forbiddenChars = cleaned.match(/[^А-ЯЁа-яёӨөҮүҢң\s?!.\-'":,]/g);
    if (forbiddenChars) {
      console.warn('⚠️ Forbidden characters found:', forbiddenChars);
      console.warn('   Characters:', forbiddenChars.map(c => 
        `"${c}" (U+${c.charCodeAt(0).toString(16).toUpperCase()})`
      ).join(', '));
    }
  
    return cleaned;
  }

  async testCleaning(text: string): Promise<string> {
    console.log('=== CLEANING TEST ===');
    console.log('Original:', text);
    console.log('Original length:', text.length);
    

    console.log('\n--- ORIGINAL CHARACTERS ---');
    for (let i = 0; i < Math.min(text.length, 50); i++) {
      const char = text[i];
      const code = char.charCodeAt(0);
      const hex = code.toString(16).toUpperCase().padStart(4, '0');
      const isAllowed = /[А-ЯЁа-яёӨөҮүҢң\s?!.\-'":,]/.test(char);
      console.log(`  [${i}] "${char}" = U+${hex} ${isAllowed ? '✅' : '❌ FORBIDDEN'}`);
    }
  
    const cleaned = this.cleanTextForChimege(text);
    
    console.log('\n--- CLEANED RESULT ---');
    console.log('Cleaned:', cleaned);
    console.log('Cleaned length:', cleaned.length);
    

    const tests = {
      'Has Latin letters': /[a-zA-Z]/.test(cleaned),
      'Has numbers': /\d/.test(cleaned),
      'Has forbidden Unicode': !/^[А-ЯЁа-яёӨөҮүҢң\s?!.\-'":,]*$/.test(cleaned),
    };
    
    console.log('\n--- VALIDATION ---');
    console.log('Tests:', tests);
    
    if (tests['Has forbidden Unicode']) {
      const forbidden = cleaned.match(/[^А-ЯЁа-яёӨөҮүҢң\s?!.\-'":,]/g);
      console.log('Forbidden chars:', forbidden);
    } else {
      console.log('All characters are allowed');
    }
    
    return cleaned;
  }

  async generateFromScript(
    narration: string,
    options?: ChimegeOptions
  ): Promise<AudioGenerationResult> {
    try {
      const chunks = this.splitTextIntoChunks(narration, 500);

      if (chunks.length === 1) {
        return await this.textToSpeech(chunks[0], options);
      }

      const audioBuffers: Buffer[] = [];

      for (let i = 0; i < chunks.length; i++) {
        console.log(`Generating audio chunk ${i + 1}/${chunks.length}...`);
        
        const result = await this.textToSpeech(chunks[i], options);
        audioBuffers.push(result.audioBuffer);

        if (i < chunks.length - 1) {
          await this.delay(1000);
        }
      }

      const mergedBuffer = Buffer.concat(audioBuffers);

      return {
        audioBuffer: mergedBuffer,
        format: 'wav'
      };

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

          if (wordChunk.trim().length > 0) {
            currentChunk = wordChunk;
          }
        } else {
          currentChunk = trimmedSentence + '. ';
        }
      } else {
        currentChunk += trimmedSentence + '. ';
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  async uploadToCloudinary(audioBuffer: Buffer, filename: string): Promise<string> {
    const cloudinary = require('cloudinary').v2;

    cloudinary.config({
      cloud_name: CLOUDNAME,
      api_key: CLOUD_API_KEY,
      api_secret: CLOUD_API_SECRET
    });

    console.log("CLOUDINARY:", {
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
          if (error) {
            reject(error);
          } else {
            resolve(result.secure_url);
          }
        }
      );

      uploadStream.end(audioBuffer);
    });
  }

  async generateWithRetry(
    text: string,
    options?: ChimegeOptions,
    maxRetries: number = 3
  ): Promise<AudioGenerationResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Audio generation attempt ${attempt}/${maxRetries}...`);

        const result = await this.textToSpeech(text, options);
        
        return result;

      } catch (error: any) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message);

        if (error.response?.status === 429 && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`Rate limited. Waiting ${waitTime}ms...`);
          await this.delay(waitTime);
          continue;
        }

        if (error.message.includes('special characters') && attempt < maxRetries) {
          console.log('Text contains special characters. Applying extra cleaning...');
          continue;
        }

        if (attempt === maxRetries) {
          break;
        }

        await this.delay(1000);
      }
    }

    throw new Error(`Audio generation failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new AudioService();