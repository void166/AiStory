// services/ai/scriptService.ts
import Groq from 'groq-sdk';

interface ScriptScene {
  time: string;
  scene: string;
  description: string;
}

interface BackgroundImage {
  id: number;
  prompt: string;
}

interface ScriptResponse {
  title: string;
  duration: string;
  script: ScriptScene[];
  backgroundImages: BackgroundImage[];
}

class ScriptService {
  private groq: Groq;

  constructor() {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API || ''
    });
  }

  /**
   * Generate script from topic
   */
  async generate(topic: string, options?: {
    duration?: number;
    genre?: string;
    language?: string;
  }): Promise<ScriptResponse> {
    const duration = options?.duration || 60;
    const genre = options?.genre || 'horror';
    const language = options?.language || 'English';

    // Build prompt
    const prompt = this.buildPrompt(topic, duration, genre, language);

    // Call AI
    const aiResponse = await this.callGroqAPI(prompt);

    // Parse response
    const scriptData = this.parseResponse(aiResponse);

    // Validate
    this.validateScript(scriptData);

    return scriptData;
  }

  /**
   * Build prompt for AI
   */
  private buildPrompt(
    topic: string, 
    duration: number, 
    genre: string,
    language: string
  ): string {
    const sceneCount = Math.ceil(duration / 5);

    return `
Generate a ${genre} reel script.

Return ONLY valid JSON in this exact format:

{
  "title": "Creative title here",
  "duration": "${duration}",
  "script": [
    {
      "time": "0-5",
      "scene": "Brief scene description",
      "description": "Detailed description for this scene"
    }
  ],
  "backgroundImages": [
    {
      "id": 1,
      "prompt": "Detailed image generation prompt in English"
    }
  ]
}

RULES:
- Do NOT add any explanation or markdown
- Output ONLY the JSON object
- Create exactly ${sceneCount} scenes (each 5 seconds)
- Each scene must have unique time range
- Create ${Math.ceil(sceneCount / 3)} background image prompts
- Image prompts must be VERY detailed for AI image generation
- Include lighting, atmosphere, camera angle, colors
- Language for narration: ${language}
- Image prompts: Always in English

Topic: ${topic}
    `.trim();
  }

  /**
   * Call Groq API
   */
  private async callGroqAPI(prompt: string): Promise<string> {
    try {
      const chat = await this.groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: "You are a professional script writer. Output ONLY valid JSON, no markdown, no explanations, no code blocks."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000,
        top_p: 1,
        stream: false
      });

      const content = chat.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('Empty response from AI');
      }

      return content;

    } catch (error: any) {
      console.error('Groq API error:', error);
      throw new Error(`AI API failed: ${error.message}`);
    }
  }

  /**
   * Parse and clean AI response
   */
  private parseResponse(response: string): ScriptResponse {
    try {
      // Clean markdown and extra text
      let cleaned = response.trim();

      // Remove markdown code blocks
      cleaned = cleaned.replace(/```json\n?/gi, '');
      cleaned = cleaned.replace(/```\n?/gi, '');

      // Find first { and last }
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');

      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error('No valid JSON found in response');
      }

      cleaned = cleaned.substring(firstBrace, lastBrace + 1);

      // Parse JSON
      const parsed = JSON.parse(cleaned);

      return parsed as ScriptResponse;

    } catch (error: any) {
      console.error('Parse error:', error);
      console.error('Response was:', response);
      throw new Error(`Failed to parse AI response: ${error.message}`);
    }
  }

  /**
   * Validate script structure
   */
  private validateScript(script: any): void {
    if (!script) {
      throw new Error('Script is null or undefined');
    }

    if (!script.title || typeof script.title !== 'string') {
      throw new Error('Script must have a valid title');
    }

    if (!script.duration) {
      throw new Error('Script must have duration');
    }

    if (!Array.isArray(script.script)) {
      throw new Error('Script.script must be an array');
    }

    if (script.script.length === 0) {
      throw new Error('Script must have at least one scene');
    }

    if (!Array.isArray(script.backgroundImages)) {
      throw new Error('Script.backgroundImages must be an array');
    }

    // Validate each scene
    script.script.forEach((scene: any, index: number) => {
      if (!scene.time || !scene.scene || !scene.description) {
        throw new Error(`Scene ${index + 1} is missing required fields`);
      }
    });
  }

  /**
   * Regenerate specific scene
   */
  async regenerateScene(
    originalScript: ScriptResponse,
    sceneIndex: number,
    customPrompt?: string
  ): Promise<ScriptScene> {
    const scene = originalScript.script[sceneIndex];
    
    if (!scene) {
      throw new Error(`Scene ${sceneIndex} not found`);
    }

    const prompt = customPrompt || `
Rewrite this scene in a different way:

Time: ${scene.time}
Original: ${scene.scene}
Description: ${scene.description}

Return JSON:
{
  "time": "${scene.time}",
  "scene": "New scene description",
  "description": "New detailed description"
}
    `.trim();

    const response = await this.callGroqAPI(prompt);
    const parsed = this.parseResponse(response);

    return parsed.script[0];
  }
}

export default new ScriptService();