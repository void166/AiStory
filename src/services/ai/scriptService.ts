import Groq from 'groq-sdk';
import { GoogleGenAI } from "@google/genai";
import OpenAI from 'openai';
import { config } from '../../config';


const {OPENAI_API_KEY,GROQ_API} =config;

interface ScriptScene {
  time: string;
  scene: string;
  visual: string;
  narration: string;
  imagePrompt: string;
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
  private openai: OpenAI;

  constructor() {
    this.groq = new Groq({ apiKey: GROQ_API});
    this.openai = new OpenAI({apiKey: OPENAI_API_KEY});
  }

  private IMAGE_STYLE: Record<string, string> = {
    comic: "Traditional American Comic Book style, heavy black ink outlines, flat saturated colors, Ben-Day dots, dramatic high-contrast shadows",
    creepyComic: "Horror comic aesthetic, scratchy quill-and-ink lines, desaturated muddy colors, unsettling proportions, extreme chiaroscuro",
    modernCartoon: "Modern 2D vector animation style, clean thick outlines, bright vibrant gradients, whimsical and friendly character design",
    disney: "Disney-Pixar 3D render style, cinematic lighting, subsurface scattering, expressive large eyes, 8k resolution octane render",
    anime: "High-quality Japanese anime film still, Makoto Shinkai style, detailed backgrounds, lens flares, atmospheric perspective, soft cinematic lighting",
    simpsons: ""
  }


private GENRE_RULES : Record<string, string> = {
  scary:`
    Tone: extremely suspenseful and disturbing
    - Psychological fear
    - Unknown threat
    - Creepy unanswered questions
    - Dark atmosphere
    - Goosebumps feeling
    - Slow tension build

    Script example — “The House That Called Names”
    
    People said the house was empty.

But every night,
someone inside
called them by name.

At first,
the town laughed.

Old houses make noises.
Wood cracks.
Pipes groan.
Wind plays tricks.

That’s what everyone said.

Until the recordings started.

One family placed a camera
outside the front door.

At 3:14 a.m.,
the porch light turned on by itself.

Then a voice came from inside.

Soft.
Slow.
Almost whispering.

It called their daughter’s name.

She was standing outside
with her parents.

No one entered.
No one left.
The doors never opened.

Police searched the house.

Nothing.

No footprints.
No intruder.
No explanation.

But after that night,
people stopped walking past the house.

Because sometimes,
just before dawn,

it doesn’t call a child’s name.

It calls yours.
  `,

  education:`
    Tone: informative but engaging
    - Teach something real
    - Clear explanations
    - Interesting facts
    - Simple storytelling
    - Curiosity driven

    Script example — “The Internet Is Not Invisible”

Every second you spend online,

you depend on machines
most people will never see.

A message feels instant.
A video loads in seconds.
A photo crosses the world
almost immediately.

So it feels invisible.

But it isn’t.

Behind every click
are massive data centers.

Buildings filled
with rows of servers
running day and night.

They store information.
Move data.
Power apps.
Handle billions of requests.

And they consume
enormous amounts of electricity.

They produce so much heat,
some facilities need
advanced cooling systems
just to keep operating.

If enough of them failed at once,

banking would stall.
Websites would disappear.
Cloud tools would stop.
Communication would slow down.

The internet feels weightless.

But in reality,

it depends on one of the largest
physical infrastructures
humans have ever built.

And most people never think about it
until it stops working.

  `,
  history: `
    Tone: documentary historical storytelling
    - Real events
    - Timeline progression
    - Serious narration
    - Dramatic historical tone


    Script example — “The Day Pompeii Disappeared”
In a single day,

an entire city
vanished under ash.

Pompeii was once
a busy Roman city.

Its streets were crowded.
Its markets were alive.
Its people lived
beneath the shadow
of Mount Vesuvius.

But they did not know
what was coming.

In 79 AD,
the volcano erupted.

At first,
ash began falling from the sky.

Then came the smoke.
Then the fire.
Then the deadly clouds
moving faster than people could run.

Homes collapsed.
Streets disappeared.
Families were trapped
where they stood.

In just hours,
the city was buried.

For centuries,
Pompeii remained hidden.

Until archaeologists uncovered it,
frozen in time.

Roads.
Walls.
Objects.
Even the final moments
of the people who lived there.

History did not just remember Pompeii.

It preserved its last breath.
  `,
  trueCrime:`
    Tone: dark true crime documentary
    - Real incident
    - Investigation vibe
    - Evidence and mystery
    - Tension and unanswered questions

    Script example — “The Man Who Entered and Never Returned”
A man walked into an elevator.

And then,
he disappeared.

Security cameras showed him
entering alone
late at night.

He pressed a button.
The doors closed.

Nothing unusual.

But when the elevator opened again,

he was gone.

Police checked the building.

No emergency exit.
No hidden shaft.
No sign of a struggle.

His car was still parked outside.

His phone
was found in his office.

His wallet was untouched.

It was as if
he had simply stopped existing
between one floor and the next.

Investigators reviewed the footage
again and again.

Frame by frame.

No one entered.
No one left.
No clear malfunction.
No explanation.

Some believed
he planned everything.

Others believed
something happened
inside that elevator
that was never captured.

The case was never solved.

And the video still remains—

showing a man step inside,

and never come back out.
  `,
  stoic:`
    Tone: powerful stoic motivation
    - Discipline
    - Struggle and resilience
    - Inner strength
    - Calm but powerful voice
    - Philosophical message


    Script example — “Discipline Is Freedom”

Most people think discipline
is a form of punishment.

It isn’t.

It is freedom.

Without discipline,
your mood controls you.

Your fear controls you.
Your habits control you.
Your distractions control you.

You say you want more.

A better body.
A stronger mind.
A better life.

But wanting is easy.

The hard part
is showing up
when you are tired,
unmotivated,
and full of excuses.

That is where discipline begins.

Not when things feel good.

When they don’t.

Because real strength
is not loud.

It does not beg for attention.

It is the quiet decision
to keep going
when no one is watching.

Anyone can act powerful
for a moment.

But the person
who controls himself
day after day—

that is the person
who becomes unbreakable.
  `,
}

  async generate(topic: string, imageStyle: string, options?: {
    duration?: number;
    genre?: string;
    language?: string;
  }): Promise<ScriptResponse> {
    const duration = options?.duration || 60;
    const genre = options?.genre || 'stoic';
    const language = options?.language || 'mongolian';
    const stylePrompt = this.IMAGE_STYLE[imageStyle] || this.IMAGE_STYLE.anime;

    const langInstruction = language === 'mongolian'
      ? `Write narration in Mongolian Cyrillic (А-ЯЁа-яёӨөҮүНн only). Same emotional style as the reference — translated into Mongolian.`
      : `Write narration in English. Match the reference style exactly.`;

    const prompt = `
You are a viral short-video scriptwriter.

Topic: "${topic}"
Genre: ${genre}
Target duration: ~${duration} seconds

TOPIC CONTEXT — research everything you know about this topic and use it:
- Use REAL names, REAL events, REAL details from the topic
- Every narration line must be SPECIFICALLY about "${topic}" — not generic
- If the topic is a person, team, or event — reference their actual story, achievements, struggles
- Never write lines that could apply to ANY other topic — make it unique to "${topic}"

NARRATION STYLE — match this EXACTLY:
---
${this.GENRE_RULES[genre]}
---

Study that reference. Notice:
- Each line is 1 short sentence or phrase
- Ellipsis "…" for dramatic pauses
- Em dash "—" for sudden emotional reveals
- Builds tension slowly then hits hard
- Conversational, human, not formal
- Questions that make the viewer think
- Each line feels like its own scene beat

${langInstruction}

Scene timing rules (you decide, must total ~${duration}s):
- 1 short line = 1–2s
- 1 medium line = 3s
- 1 longer line = 4–5s

STRICT RULES — never break these:
- NEVER add a "Closing Credits", "Credits", or "Outro" scene
- EVERY scene MUST have real spoken narration — a real sentence or phrase
- NEVER use "…" alone as narration — ellipsis is only allowed inside a sentence
- NEVER pad time with silent or empty scenes
- The script ends on the last real narration line — no filler at the end

IMAGE PROMPT RULES (CRITICAL — read every rule carefully):

SPECIFICITY:
- imagePrompt MUST name the actual subject — never use generic descriptions
- BAD: "A dramatic scene of a team standing together" ← rejected, could be any team
- GOOD: "The Mongolz CS2 team in anime style, five players in a dark arena, Mongolian flag colors, determined expressions, dramatic backlight" ← specific and vivid

EMOTION-TO-VISUAL TRANSLATION:
- Take the emotion/meaning of the narration and express it through the ACTUAL topic subject
- If narration = triumph → show the subject in a victorious moment
- If narration = struggle → show the subject under pressure, not a random struggle
- Camera angle, lighting, color palette must reinforce the narration's emotion

COMPOSITION (MANDATORY — image generation model will follow this):
- Every imagePrompt must end with: "Portrait vertical composition, subject centered, all elements fully visible within frame, no edge cropping, safe margins on all sides"
- Specify camera framing: close-up / medium shot / wide shot — choose what matches the scene
- Specify lighting: e.g. "dramatic rim light from behind", "soft golden hour", "cold blue night light"
- Specify mood/atmosphere: foggy, tense, epic, melancholic, triumphant, etc.

PORTRAIT FORMAT REMINDER:
- The image will be cropped to 1080×1920 (portrait). Always design the scene with a VERTICAL canvas in mind
- Place the main subject in the CENTER — never at the edges

Visual style for ALL imagePrompts: ${stylePrompt}

Return ONLY this JSON:
{
  "title": "...",
  "duration": "total seconds",
  "script": [
    {
      "time": "0:00-0:02",
      "scene": "Scene title (English)",
      "visual": "Brief visual description (English)",
      "narration": "One punchy line",
      "imagePrompt": "Highly specific prompt: [subject name], [scene], [camera angle], [lighting], [mood/color palette], [style]. Must end with: portrait vertical composition, subject centered, all elements fully visible, no edge cropping."
    }
  ],
  "backgroundImages": []
}

JSON only. No markdown.
`.trim();
let aiResponse;

aiResponse = await this.callGroqAPI(prompt);

// try{
//   const aiResponse = await this.callOpenAI(prompt);
// }catch(err:any){
//   console.error({
//     success: false,
//     err
//   })
//   console.log("openai failed,");

//    aiResponse = await this.callGroqAPI(prompt);
// }


    if (!aiResponse) {
      throw new Error('AI response is undefined');
    }
    const scriptData = this.parseResponse(aiResponse);

    scriptData.script = scriptData.script
      .map(scene => ({
        ...scene,
        narration: this.cleanNarration(scene.narration, language)
      }))
      .filter(scene => {
        const n = scene.narration.replace(/[….\s\-—]/g, '').trim();
        return n.length > 0;
      });

    this.validateScript(scriptData);
    return scriptData;
  }

  private async callOpenAI(prompt: string): Promise<string> {
    const chat = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a viral short-video scriptwriter." },
        { role: "user", content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 8000
    });
  
    const content = chat.choices[0]?.message?.content;
  
    if (!content) throw new Error("Empty response from OpenAI");
  
    return content;
  }

  private async callGroqAPI(prompt: string): Promise<string> {
    console.log('🤖 Calling Groq API...');

    const chat = await this.groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a viral documentary scriptwriter. Your narration is emotional, punchy, human. Output ONLY valid JSON. No markdown."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 8000,
      stream: false
    });

    const content = chat.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from Groq');

    console.log(`Response: ${content.length} chars`);
    return content;
  }

  private parseResponse(response: string): ScriptResponse {
    let cleaned = response.trim().replace(/```json/gi, '').replace(/```/g, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON found in response');
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  private cleanNarration(text: string, language = 'mongolian'): string {
    let c = text.normalize('NFC');

    if (language === 'mongolian') {
      // For Mongolian: strip Latin/numbers but keep drama punctuation
      c = c.replace(/[^А-ЯЁа-яёӨөҮүҢң\s?!.,:\-—…"']/g, '');
    }
    // else keep as-is for English, just normalize below

    c = c.replace(/\.{2,}/g, '…');   // .. or ... → …
    c = c.replace(/--/g, '—');        // -- → —
    c = c.replace(/([?!.,:])\1+/g, '$1');
    c = c.replace(/\s+([?!.,:\-—…])/g, '$1');
    c = c.replace(/\s+/g, ' ').trim();
    return c;
  }

  private validateScript(script: any): void {
    if (!script?.title) throw new Error('Missing title');
    if (!Array.isArray(script.script) || script.script.length === 0) throw new Error('Empty script');
    if (!Array.isArray(script.backgroundImages)) script.backgroundImages = [];

    script.script.forEach((s: any, i: number) => {
      ['time', 'scene', 'visual', 'narration', 'imagePrompt'].forEach(f => {
        if (!s[f]) throw new Error(`Scene ${i + 1} missing: ${f}`);
      });
    });

    console.log(`✅ Script OK: ${script.script.length} scenes`);
  }

  async regenerateScene(
    originalScript: ScriptResponse,
    sceneIndex: number,
    customPrompt?: string
  ): Promise<ScriptScene> {
    const scene = originalScript.script[sceneIndex];
    if (!scene) throw new Error(`Scene ${sceneIndex} not found`);

    const prompt = customPrompt || `
Rewrite this scene narration in the style of:
"Yet somehow — they started defeating international giants."
"Just raw aim. And relentless grind."
"Was it pure talent… or something more?"

Time: ${scene.time}
Current narration: "${scene.narration}"

Make it more emotional and punchy. Keep same time range.

JSON only:
{ "time": "${scene.time}", "scene": "...", "visual": "...", "narration": "...", "imagePrompt": "..." }
`.trim();

    const response = await this.callGroqAPI(prompt);
    let parsed: any;

    try {
      parsed = JSON.parse(response.replace(/```json/gi, '').replace(/```/g, ''));
    } catch {
      const match = response.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Failed to parse regenerated scene');
    }

    if (parsed.narration) parsed.narration = this.cleanNarration(parsed.narration);

    ['time', 'scene', 'visual', 'narration', 'imagePrompt'].forEach(f => {
      if (!parsed[f]) throw new Error(`Missing: ${f}`);
    });

    return parsed as ScriptScene;
  }

  async getScriptById(_scriptId: string): Promise<ScriptResponse> {
    throw new Error('getScriptById not implemented yet');
  }

  async updateScript(_scriptId: string, _updates: Partial<ScriptResponse>): Promise<void> {}
}

export default new ScriptService();