// controllers/audioController.ts
import { Request, Response } from 'express';
import audioService from '../services/ai/aud';

export class AudioController {

   // POST /api/audio/generate

async generateAudio(req: Request, res: Response) {
  try {
    const { text, voice_id, speed, pitch, sample_rate } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Text is required'
      });
    }

    console.log('Generating audiosda...');

    // Generate audio with options
    const result = await audioService.textToSpeech(text, {
      voice_id,
      speed,
      pitch,
      sample_rate
    });

    // Upload to Cloudinary
    const filename = `audio_${Date.now()}.wav`;
    const audioUrl = await audioService.uploadToCloudinary(
      result.audioBuffer, 
      filename
    );

    return res.status(200).json({
      success: true,
      message: 'Audio generated successfully',
      data: {
        audioUrl,
        format: result.format,
        size: result.audioBuffer.length
      }
    });

  } catch (error: any) {
    console.error('Audio generation error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to generate audio',
      error: error.message
    });
  }
}
// Add test endpoint to controller
async testTextCleaning(req: Request, res: Response) {
  try {
    const { text } = req.body;
    const cleaned = await audioService.testCleaning(text);
    
    return res.json({
      original: text,
      cleaned: cleaned,
      safe: !/[^А-ЯҢҮӨа-яңүө\s?!.\-'":,]/.test(cleaned)
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

  /**
   * Generate and download audio
   * POST /api/audio/generate-download
   */
  async generateAndDownload(req: Request, res: Response) {
    try {
      const { text } = req.body;
      console.log("Cloudinary key:", process.env.CLOUD_API_KEY);
      
      if (!text || text.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Text is required'
        });
      }

      // Generate audio
      const result = await audioService.textToSpeech(text);

      // Set headers for download
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', `attachment; filename="audio_${Date.now()}.wav"`);
      res.setHeader('Content-Length', result.audioBuffer.length);

      // Send buffer
      return res.send(result.audioBuffer);

    } catch (error: any) {
      console.error('Audio download error:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to generate audio',
        error: error.message
      });
    }
  }

  /**
   * Generate audio from script
   * POST /api/audio/generate-from-script
   */
  async generateFromScript(req: Request, res: Response) {
    try {
      const { script } = req.body;

      if (!script || !script.narration) {
        return res.status(400).json({
          success: false,
          message: 'Script with narration is required'
        });
      }

      // Generate audio
      const result = await audioService.generateFromScript(script.narration);

      // Upload to S3
      const filename = `script_audio_${Date.now()}.wav`;
      const audioUrl = await audioService.uploadToCloudinary(result.audioBuffer, filename);

      return res.status(200).json({
        success: true,
        message: 'Script audio generated',
        data: {
          audioUrl,
          format: result.format,
          size: result.audioBuffer.length,
          narration: script.narration
        }
      });

    } catch (error: any) {
      console.error('Script audio generation error:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to generate script audio',
        error: error.message
      });
    }
  }
}

export default new AudioController();