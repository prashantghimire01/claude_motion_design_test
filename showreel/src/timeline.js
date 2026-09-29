// Shared timeline: the single source of truth for picture AND sound.
// Everything is expressed in beats at 128 BPM — 32 beats (8 bars) = exactly 15.000 s.
// Imported by the browser renderer and by the Node soundtrack synth.

export const W = 1920;
export const H = 1080;
export const FPS = 60;
export const BPM = 128;
export const BEAT = 60 / BPM; // 0.46875 s
export const BEATS = 32;
export const DURATION = BEATS * BEAT; // 15 s
export const FRAMES = Math.round(DURATION * FPS); // 900

export const sec = (beats) => beats * BEAT;
export const beatsAt = (seconds) => seconds / BEAT;
export const frameOfBeat = (b) => Math.round(b * BEAT * FPS);

// Chapters drive the HUD label (the "skill" being demonstrated).
export const CHAPTERS = [
  { from: 0, title: 'TIMING' },
  { from: 4, title: 'TYPOGRAPHY' },
  { from: 8, title: 'SHAPE' },
  { from: 12, title: 'SYSTEMS' },
  { from: 16, title: 'DIMENSION' },
  { from: 20, title: 'PRINCIPLES' },
  { from: 24, title: 'GENERATIVE' },
  { from: 28, title: 'HELLO' },
];

// Render segments: each one is a renderer that owns a span of the reel.
export const SEGMENTS = [
  { id: 'intro', from: 0, to: 8 },
  { id: 'world', from: 8, to: 20 },
  { id: 'principles', from: 20, to: 24 },
  { id: 'finale', from: 24, to: 32 },
];

// ---------------------------------------------------------------------------
// Choreography events (beats). Visuals animate to these; the synth plays them.
// ---------------------------------------------------------------------------

// The bouncing ball: coefficient of restitution 0.5 => each airtime halves,
// giving the classic accelerating "tock . . tock . tock-tock-trrr" rhythm.
export const BOUNCE = {
  dropStart: 0.0, // released above frame
  landings: [1.0, 2.0, 2.5, 2.75, 2.875, 2.9375],
  restAt: 3.0,
};

// Letters of "motıon" rise out of the floor line, rippling out from the ı.
// index: m o t ı o n
export const LETTER_RISE = [4.75, 4.5, 4.25, 4.0, 4.25, 4.5];
export const WORD_WIDTH_FLEX = 5.5; // variable-width flex on the word
export const HOP = { anticipate: 5.75, launch: 6.0, dive: 6.5, portal: 6.5 };
export const ZOOM = { from: 6.75, to: 8.0 };

// World (shader oner)
export const WORLD = {
  drop: 8.0,
  split3: 8.5,
  split9: 9.5,
  morph: 10.0,
  claim: 11.0, // blobs claim their tiles
  zoomOut: 12.0,
  tileWaves: [13.0, 13.5, 14.0, 14.5, 15.0, 15.5],
  tilt: 16.0,
  ballDrop: 16.5,
  ballLand: [17.0, 18.0, 18.5, 18.75],
  launch: 19.0,
  lensHit: 20.0,
};

// Principles cards (one per beat)
export const PRINCIPLES = [
  { at: 20, word: 'SQUASH', no: '01', name: 'SQUASH & STRETCH' },
  { at: 21, word: 'STRETCH', no: '01', name: 'SQUASH & STRETCH' },
  { at: 22, word: 'ANTICIPATION', no: '02', name: 'ANTICIPATION' },
  { at: 23, word: 'FOLLOW THROUGH', no: '05', name: 'FOLLOW THROUGH' },
];

// Finale
export const FINALE = {
  shatter: 24.0,
  converge: 27.0,
  impact: 28.0,
  subtitle: 28.5,
  details: 29.0,
  periodDrop: 29.5,
  periodLandings: [30.0, 30.5, 30.75, 30.875],
  settle: 31.0,
};

// Camera/post impacts: [beat, strength]
export const IMPACTS = [
  [8.0, 1.0],
  [17.0, 0.55],
  [20.0, 0.8],
  [24.0, 0.45],
  [28.0, 1.2],
  [30.0, 0.18],
];

// Harmony (used by the synth, and by visuals that pulse with chord changes)
export const CHORDS = [
  { from: 0, to: 4, name: 'Fmaj7', notes: [53, 57, 60, 64], root: 41 },
  { from: 4, to: 8, name: 'G6', notes: [55, 59, 62, 64], root: 43 },
  { from: 8, to: 12, name: 'Fmaj7', notes: [53, 57, 60, 64], root: 41 },
  { from: 12, to: 16, name: 'G6', notes: [55, 59, 62, 64], root: 43 },
  { from: 16, to: 20, name: 'Em7', notes: [52, 55, 59, 62], root: 40 },
  { from: 20, to: 24, name: 'Am7', notes: [57, 60, 64, 67], root: 45 },
  { from: 24, to: 26, name: 'Fmaj7', notes: [53, 57, 60, 64], root: 41 },
  { from: 26, to: 28, name: 'Gsus4', notes: [55, 60, 62, 67], root: 43 },
  { from: 28, to: 32, name: 'Cmaj9', notes: [48, 52, 55, 59, 62], root: 36 },
];
