// Font loading. Archivo is a variable font (wdth 62–125, wght 100–900).
// Canvas only exposes font-stretch keywords, so we register one FontFace per
// integer width with a fixed `stretch` descriptor: the browser clamps into that
// range, which lets us animate the width axis continuously from canvas.

const WIDTH_MIN = 62;
const WIDTH_MAX = 125;

export async function loadFonts(base = './fonts/') {
  const get = async (f) => (await fetch(base + f)).arrayBuffer();
  const [archivo, serifR, serifI, mono] = await Promise.all([
    get('Archivo-VF.ttf'),
    get('InstrumentSerif-Regular.ttf'),
    get('InstrumentSerif-Italic.ttf'),
    get('JetBrainsMono-VF.ttf'),
  ]);
  const faces = [];
  for (let w = WIDTH_MIN; w <= WIDTH_MAX; w++) {
    faces.push(new FontFace('AW' + w, archivo, { stretch: w + '%', weight: '100 900' }));
  }
  faces.push(new FontFace('ISerif', serifR));
  faces.push(new FontFace('ISerifI', serifI, { style: 'normal' }));
  faces.push(new FontFace('JBMono', mono, { weight: '100 800' }));
  await Promise.all(faces.map((f) => f.load()));
  faces.forEach((f) => document.fonts.add(f));
}

// Archivo at any weight / width / size.
export function archivo(weight, width, size) {
  const w = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, Math.round(width)));
  return `${Math.round(weight)} ${size}px AW${w}`;
}
export const serif = (size, italic = true) => `${size}px ${italic ? 'ISerifI' : 'ISerif'}`;
export const mono = (weight, size) => `${weight} ${size}px JBMono`;
