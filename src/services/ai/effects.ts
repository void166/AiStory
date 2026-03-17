// ─────────────────────────────────────────────────────────────────────────────
// effects.ts — Cinematic Visual Effects System
//
// All effects are pure FFmpeg filter expressions.
// No external assets, no runtime dependencies beyond ffmpeg itself.
// ─────────────────────────────────────────────────────────────────────────────

export const OUT_W = 1080;
export const OUT_H = 1920;
const FPS = 30;

// ─── Types ───────────────────────────────────────────────────────────────────

export type MotionPreset 
  = 'push-in' | 'zoom-out' | 'drift-left' | 'drift-right' | 'float' | 'hook-reveal';
export type TransitionPreset = 'fadeblack' | 'fade' | 'hard-cut';

export interface SceneEffectConfig {
  motion: MotionPreset;
  transition: TransitionPreset;  // transition INTO the NEXT scene
  impact: boolean;               // short punchy narration — add shake
}

// ─── Motion preset sequence (non-hook scenes) ────────────────────────────────
// Cycles in this order so consecutive scenes always feel different.
const MOTION_SEQUENCE: MotionPreset[] = [
  'push-in',
  'drift-left',
  'zoom-out',
  'float',
  'push-in',
  'drift-right',
  'zoom-out',
  'push-in',
];

// ─── Scene effect assignment ─────────────────────────────────────────────────
// Called once per video, before filter_complex is built.

export function assignSceneEffects(scenes: Array<{ narration: string }>): SceneEffectConfig[] {
  return scenes.map((scene, i) => {
    // Hook: first scene always gets the reveal motion
    const motion: MotionPreset = i === 0
      ? 'hook-reveal'
      : MOTION_SEQUENCE[(i - 1) % MOTION_SEQUENCE.length];

    // Impact: short punchy narration (≤ 6 words)
    const wordCount = scene.narration.trim().split(/\s+/).length;
    const impact = wordCount <= 6;

    // Transition to next scene:
    // fadeblack is the default — most cinematic for dark/dramatic content.
    // Every 5th transition: cross-dissolve for emotional continuity.
    // Last scene: no transition needed (value is ignored).
    const transition: TransitionPreset = (i % 5 === 3) ? 'fade' : 'fadeblack';

    return { motion, transition, impact };
  });
}

// ─── Motion filter builder ───────────────────────────────────────────────────
// Returns the zoompan filter string for a scene.
// Input must be pre-scaled to 1620×2880 (1.5× output) for quality headroom.

export function buildMotionFilter(preset: MotionPreset, durationSecs: number, impact: boolean): string {
  const frames = Math.max(Math.round(durationSecs * FPS), 1);

  // Base zoompan expressions per preset
  const motions: Record<MotionPreset, { z: string; x: string; y: string }> = {
    // Gentle push toward subject — universal, works on any composition
    'push-in': {
      z: `1.0+0.12*(on/${frames})`,
      x: `iw/2-(iw/zoom/2)`,
      y: `ih/2-(ih/zoom/2)`,
    },
    // Pull back slowly — reveal / distance / historical melancholy
    'zoom-out': {
      z: `max(1.12-0.12*(on/${frames}),1.0)`,
      x: `iw/2-(iw/zoom/2)`,
      y: `ih/2-(ih/zoom/2)`,
    },
    // Slow horizontal drift (subject floats left to right) — wide/landscape shots
    'drift-left': {
      z: `1.08`,
      x: `(iw/2-(iw/zoom/2))+on/${frames}*60`,
      y: `ih/2-(ih/zoom/2)`,
    },
    // Slow horizontal drift reversed — creates contrast after drift-left
    'drift-right': {
      z: `1.08`,
      x: `(iw/2-(iw/zoom/2))-on/${frames}*60`,
      y: `ih/2-(ih/zoom/2)`,
    },
    // Subtle diagonal float — good for portrait/character images
    'float': {
      z: `1.0+0.06*(on/${frames})`,
      x: `(iw/2-(iw/zoom/2))+on/${frames}*25`,
      y: `(ih/2-(ih/zoom/2))+on/${frames}*15`,
    },
    // Hook reveal: starts tight (1.25×), snaps back in first 12 frames,
    // then slow push-in for the rest. Creates a visual "arrival" event.
    'hook-reveal': {
      z: `if(lt(on,12),1.25-on*0.021,1.0+on*0.0007)`,
      x: `iw/2-(iw/zoom/2)`,
      y: `ih/2-(ih/zoom/2)`,
    },
  };

  const { z, x, y } = motions[preset];
  let filter = `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${FPS}`;

  // Impact shake: slight zoom-in then static centre crop.
  // Dynamic crop with eval=frame is not supported in all FFmpeg versions,
  // so we use a simple scale + static crop for broad compatibility.
  if (impact) {
    filter += `,scale=${Math.round(OUT_W * 1.03)}:${Math.round(OUT_H * 1.03)}`;
    filter += `,crop=${OUT_W}:${OUT_H}`;
  }

  return filter;
}

// ─── Atmosphere filter ───────────────────────────────────────────────────────
// Applied to every scene after motion. Defines the visual "look" of the whole video.
// Order matters: grade → vignette → grain (grain must be last or it gets washed).

export function buildAtmosphereFilter(): string {
  // 1. Color grade: slight shadow lift (b channel +0.05), highlight rolloff,
  //    15% desaturation, very slight teal-blue push in shadows.
  //    Curves format: 'input/output pairs' normalized 0–1.
  const colorGrade =
    `curves=` +
    `r='0/0.01 0.5/0.44 1/0.95':` +
    `g='0/0.01 0.5/0.47 1/0.92':` +
    `b='0/0.05 0.5/0.52 1/1.00',` +
    `eq=contrast=1.05:brightness=-0.03:saturation=0.83`;

  // 2. Vignette: PI/4 (≈45°) — moderate edge darkening.
  //    angle=PI/4, mode=forward (default). eval=frame removed for compatibility.
  const vignette = `vignette=angle=PI/4`;

  // 3. Film grain: noise strength 9, type=t (temporal) + u (uniform).
  //    Temporal noise changes per frame giving organic film texture.
  //    Strength 9 is at the edge of perception — present but subliminal.
  const grain = `noise=alls=9:allf=t+u`;

  return `${colorGrade},${vignette},${grain}`;
}

// ─── Per-scene complete filter chain ─────────────────────────────────────────
// Returns the full filter string for a single scene input stream.
// Input is expected to be a raw image stream from `-loop 1 -t DURATION -i image.png`.

export function buildSceneFilter(
  preset: MotionPreset,
  durationSecs: number,
  impact: boolean
): string {
  // Step 1: Oversized scale to give zoompan quality headroom (1.5× = 1620×2880).
  //         force_original_aspect_ratio=increase then crop ensures no black bars.
  const oversizeW = Math.round(OUT_W * 1.5);
  const oversizeH = Math.round(OUT_H * 1.5);
  const prescale = `scale=${oversizeW}:${oversizeH}:force_original_aspect_ratio=increase,crop=${oversizeW}:${oversizeH},setsar=1,fps=${FPS}`;

  // Step 2: Motion (zoompan) + optional impact shake → outputs OUT_W × OUT_H
  const motion = buildMotionFilter(preset, durationSecs, impact);

  // Step 3: Atmosphere (color grade + vignette + grain)
  const atmosphere = buildAtmosphereFilter();

  return `${prescale},${motion},${atmosphere}`;
}

// ─── Transition builder ───────────────────────────────────────────────────────
// Returns the xfade transition string for a given preset.
// 'hard-cut' is handled separately in the filter_complex builder.

export function buildTransitionFilter(preset: TransitionPreset, offset: number): string | null {
  if (preset === 'hard-cut') return null; // caller handles this

  const duration = preset === 'fadeblack' ? 0.4 : 0.3;
  return `xfade=transition=${preset}:duration=${duration}:offset=${offset}`;
}
