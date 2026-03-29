export const OUT_W = 1080;
export const OUT_H = 1920;
export const FPS = 30;

export type MotionPreset =
  | 'push-in'
  | 'zoom-out'
  | 'drift-left'
  | 'drift-right'
  | 'float'
  | 'hook-reveal'
  | 'static';


export type TransitionPreset =
  | 'fadeblack'
  | 'fade'
  | 'wiperight'
  | 'wipeleft'
  | 'hard-cut';

export interface SceneEffectConfig {
  motion: MotionPreset;
  transition: TransitionPreset;
  impact: boolean;
}

export interface SubtitleStyle {
  fontName?: string;
  fontSize?: number;
  bold?: boolean;
  primaryColor?: string;
  outlineColor?: string;
  outlineThickness?: number;
  shadowDepth?: number;
  marginV?: number;
  /**
   * ASS alignment grid:
   * 1=bottom-left  2=bottom-center  3=bottom-right
   * 5=mid-left     6=mid-center     7=mid-right
   * 9=top-left    10=top-center    11=top-right
   */
  alignment?: 1 | 2 | 3 | 5 | 6 | 7 | 9 | 10 | 11;
  backgroundBox?: boolean;
  boxColor?: string;
  boxOpacity?: number;
}


export function getAtmosphereByGenre(genre = 'cinematic'): string {
  const g = genre.toLowerCase();

  const presets: Record<string, string> = {
    scary:
      `eq=contrast=1.25:brightness=-0.08:saturation=0.6,` +
      `curves=b='0/0.05 0.5/0.52 1/1':g='0/0 0.5/0.45 1/0.9',` +
      `vignette=angle=PI/3,noise=alls=15:allf=t+u`,

    education:
      `eq=contrast=1.05:brightness=0.02:saturation=1.1,` +
      `vignette=angle=PI/6,noise=alls=3:allf=t+u`,

    vintage:
      `eq=contrast=1.1:brightness=-0.05:saturation=0.8,` +
      `vignette=angle=PI/4,noise=alls=12:allf=t+u`,

    cinematic:
      `eq=contrast=1.05:brightness=-0.03:saturation=0.9,` +
      `vignette=angle=PI/4,noise=alls=7:allf=t+u`,
  };

  return presets[g] ?? presets.cinematic;
}

// ─── Scene-effect assignment ─────────────────────────────────────────────────

const MOTION_SEQUENCE: MotionPreset[] = [
  'push-in', 'drift-left', 'zoom-out', 'float', 'drift-right',
];

/**
 * Automatically assigns motion / transition / impact to every scene.
 * Pass `userTransition` to force the same transition for every scene.
 */
export function assignSceneEffects(
  scenes: Array<{ narration: string }>,
  userTransition?: TransitionPreset,
): SceneEffectConfig[] {
  return scenes.map((scene, i) => {
    const motion: MotionPreset =
      i === 0
        ? 'hook-reveal'
        : MOTION_SEQUENCE[(i - 1) % MOTION_SEQUENCE.length];

    const wordCount = scene.narration.trim().split(/\s+/).length;
    const impact = wordCount <= 6;

    const transition: TransitionPreset =
      userTransition ?? (i % 5 === 3 ? 'fade' : 'fadeblack');

    return { motion, transition, impact };
  });
}

// ─── Zoompan filter builder ───────────────────────────────────────────────────

export function buildMotionFilter(
  preset: MotionPreset,
  durationSecs: number,
  impact: boolean,
): string {
  const frames = Math.max(Math.round(durationSecs * FPS), 1);

  const motions: Record<MotionPreset, { z: string; x: string; y: string }> = {
    'push-in':    { z: `1.0+0.15*(on/${frames})`,                  x: `iw/2-(iw/zoom/2)`,                    y: `ih/2-(ih/zoom/2)` },
    'zoom-out':   { z: `max(1.15-0.15*(on/${frames}),1.0)`,        x: `iw/2-(iw/zoom/2)`,                    y: `ih/2-(ih/zoom/2)` },
    'drift-left': { z: `1.1`,                                       x: `(iw/2-(iw/zoom/2))+on/${frames}*80`,  y: `ih/2-(ih/zoom/2)` },
    'drift-right':{ z: `1.1`,                                       x: `(iw/2-(iw/zoom/2))-on/${frames}*80`,  y: `ih/2-(ih/zoom/2)` },
    'float':      { z: `1.0+0.08*(on/${frames})`,                   x: `(iw/2-(iw/zoom/2))+on/${frames}*30`,  y: `(ih/2-(ih/zoom/2))+on/${frames}*20` },
    'hook-reveal':{ z: `if(lt(on,15),1.3-on*0.02,1.0+on*0.0008)`, x: `iw/2-(iw/zoom/2)`,                    y: `ih/2-(ih/zoom/2)` },
    'static':     { z: `1.0`,                                       x: `iw/2-(iw/zoom/2)`,                    y: `ih/2-(ih/zoom/2)` },
  };

  const { z, x, y } = motions[preset] ?? motions['static'];
  let filter =
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${FPS}`;

  if (impact) {
    filter += `,scale=${Math.round(OUT_W * 1.05)}:${Math.round(OUT_H * 1.05)},crop=${OUT_W}:${OUT_H}`;
  }

  return filter;
}



export function buildSceneFilter(
  preset: MotionPreset,
  durationSecs: number,
  impact: boolean,
  genre = 'cinematic',
): string {

  const oversizeW = Math.round(OUT_W * 1.5);
  const oversizeH = Math.round(OUT_H * 1.5);

  const prescale =
    `scale=${oversizeW}:${oversizeH}:force_original_aspect_ratio=increase,` +
    `crop=${oversizeW}:${oversizeH},setsar=1,fps=${FPS}`;

  const motion = buildMotionFilter(preset, durationSecs, impact);
  const atmosphere = getAtmosphereByGenre(genre);

  return `${prescale},${motion},${atmosphere}`;
}



export function hexToFFmpegColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length === 6) {
    const r = clean.slice(0, 2);
    const g = clean.slice(2, 4);
    const b = clean.slice(4, 6);
    return `&H00${b}${g}${r}`;
  }
  return '&H00FFFFFF';
}

// ─── Subtitle force_style string builder ─────────────────────────────────────

const DEFAULT_SUBTITLE: Required<SubtitleStyle> = {
  fontName: 'Arial',
  fontSize: 18,
  bold: true,
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  outlineThickness: 3,
  shadowDepth: 1,
  marginV: 60,
  alignment: 2,
  backgroundBox: false,
  boxColor: '#000000',
  boxOpacity: 0.5,
};

export function buildSubtitleFilter(
  srtPath: string,
  style: SubtitleStyle = {},
): string {
  const s = { ...DEFAULT_SUBTITLE, ...style };

  const primary  = hexToFFmpegColor(s.primaryColor);
  const outline  = hexToFFmpegColor(s.outlineColor);
  const shadow   = '&H80000000';
  const border   = s.backgroundBox ? 3 : 1;

  let extraStyle = '';
  if (s.backgroundBox) {
    const alpha = Math.round((1 - s.boxOpacity) * 255)
      .toString(16).padStart(2, '0').toUpperCase();
    const raw = s.boxColor.replace('#', '');
    extraStyle = `,BackColour=&H${alpha}${raw.slice(4, 6)}${raw.slice(2, 4)}${raw.slice(0, 2)}`;
  }

  const escaped = srtPath
    .replace(/\\/g, '/')     
    .replace(/'/g, "'\\\\''") 
    .replace(/:/g, '\\:');    

  const styleProps = [
    `FontName=${s.fontName}`,
    `FontSize=${s.fontSize}`,
    `Bold=${s.bold ? 1 : 0}`,
    `PrimaryColour=${primary}`,
    `OutlineColour=${outline}`,
    `ShadowColour=${shadow}`,
    `BorderStyle=${border}`,
    `Outline=${s.outlineThickness}`,
    `Shadow=${s.shadowDepth}`,
    `Alignment=${s.alignment}`,
    `MarginV=${s.marginV}`,
  ].join(',') + extraStyle;


  return `subtitles='${escaped}':force_style='${styleProps}'`;
}