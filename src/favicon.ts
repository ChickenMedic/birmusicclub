// Animated favicon: every couple of seconds the tab icon becomes a different music-themed
// symbol (instruments, clefs, gear, or a decade in a fun font) in a different colour, on a
// transparent background. Browsers that ignore dynamic favicons (Safari) keep the static
// /favicon.svg.

const COLORS = ['#1db954', '#ff4fa3', '#4f8dff', '#b06cff', '#ffd93d', '#ff7a3d', '#3de0ff', '#ff5c5c'];

const DARK = '#1c1c24';
const LIGHT = '#f4f4f6';

type Icon = (c: string) => string;

// Each icon is drawn in a 64x64 box; `c` is the accent colour.
const ICONS: Icon[] = [
  // single note
  (c) => `<ellipse cx="24" cy="46" rx="9" ry="7" fill="${c}"/><rect x="30" y="12" width="4" height="34" fill="${c}"/>
    <path d="M34 12 C 44 14, 50 20, 48 30 C 46 24, 40 22, 34 22 Z" fill="${c}"/>`,
  // beamed pair of notes
  (c) => `<ellipse cx="18" cy="48" rx="8" ry="6" fill="${c}"/><ellipse cx="44" cy="44" rx="8" ry="6" fill="${c}"/>
    <rect x="23" y="16" width="4" height="32" fill="${c}"/><rect x="49" y="12" width="4" height="32" fill="${c}"/>
    <path d="M23 16 L53 12 L53 20 L23 24 Z" fill="${c}"/>`,
  // treble clef
  (c) => `<path d="M34 60 C 29 60, 25 56, 27 50 L 36 6 C 41 12, 43 20, 36 28 C 29 36, 19 42, 23 50 C 26 56, 36 56, 38 50 C 40 44, 32 40, 27 46"
    fill="none" stroke="${c}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="58" r="3.5" fill="${c}"/>`,
  // bass clef
  (c) => `<circle cx="18" cy="22" r="5.5" fill="${c}"/>
    <path d="M18 22 C 24 10, 40 10, 42 24 C 44 38, 30 50, 14 58" fill="none" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/>
    <circle cx="52" cy="18" r="3.5" fill="${c}"/><circle cx="52" cy="30" r="3.5" fill="${c}"/>`,
  // disco ball
  (c) => `<rect x="31" y="2" width="2" height="7" fill="${c}"/><circle cx="32" cy="35" r="24" fill="#8d99a8"/>
    ${[0, 1, 2, 3, 4].map((i) => `<line x1="8" y1="${17 + i * 9}" x2="56" y2="${17 + i * 9}" stroke="#2a2f3a" stroke-width="1.5"/>`).join('')}
    ${[0, 1, 2, 3, 4].map((i) => `<line x1="${14 + i * 9}" y1="11" x2="${14 + i * 9}" y2="59" stroke="#2a2f3a" stroke-width="1.5"/>`).join('')}
    <circle cx="32" cy="35" r="24" fill="none" stroke="${c}" stroke-width="3"/><circle cx="23" cy="26" r="5" fill="#fff" opacity="0.8"/>`,
  // vinyl record: dark disc, visible grooves, coloured label, light rim so it reads on dark tabs
  (c) => `<circle cx="32" cy="32" r="29" fill="${DARK}"/><circle cx="32" cy="32" r="29" fill="none" stroke="${LIGHT}" stroke-opacity="0.7" stroke-width="2"/>
    ${[24, 20, 16].map((r) => `<circle cx="32" cy="32" r="${r}" fill="none" stroke="${LIGHT}" stroke-opacity="0.28" stroke-width="1.5"/>`).join('')}
    <circle cx="32" cy="32" r="10" fill="${c}"/><circle cx="32" cy="32" r="2.5" fill="${DARK}"/>
    <path d="M14 20 A22 22 0 0 1 24 11" fill="none" stroke="${LIGHT}" stroke-opacity="0.6" stroke-width="2.5" stroke-linecap="round"/>`,
  // acoustic guitar
  (c) => `<rect x="26" y="0" width="12" height="9" rx="2" fill="${c}"/><rect x="29" y="6" width="6" height="26" fill="${c}"/>
    <circle cx="32" cy="36" r="11" fill="${c}"/><circle cx="32" cy="48" r="15" fill="${c}"/>
    <circle cx="32" cy="40" r="5" fill="${DARK}"/><rect x="24" y="52" width="16" height="3" rx="1.5" fill="${DARK}" fill-opacity="0.6"/>`,
  // drum with sticks
  (c) => `<line x1="12" y1="6" x2="40" y2="30" stroke="#e8d5b5" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="52" y1="6" x2="24" y2="30" stroke="#e8d5b5" stroke-width="3.5" stroke-linecap="round"/>
    <rect x="10" y="26" width="44" height="24" fill="${c}"/><ellipse cx="32" cy="50" rx="22" ry="8" fill="${c}"/>
    <ellipse cx="32" cy="26" rx="22" ry="8" fill="${LIGHT}"/>
    ${[14, 23, 32, 41, 50].map((x) => `<rect x="${x - 1.5}" y="30" width="3" height="16" fill="${DARK}" fill-opacity="0.35"/>`).join('')}`,
  // piano keys
  (c) => `<rect x="3" y="14" width="58" height="38" rx="4" fill="${LIGHT}"/>
    ${[11.3, 19.6, 27.9, 36.2, 44.5, 52.8].map((x) => `<line x1="${x}" y1="14" x2="${x}" y2="52" stroke="#9a9aa6" stroke-width="1.5"/>`).join('')}
    ${[8.5, 16.8, 33.4, 41.7, 50].map((x) => `<rect x="${x}" y="14" width="5.6" height="22" fill="${DARK}"/>`).join('')}
    <rect x="3" y="14" width="58" height="38" rx="4" fill="none" stroke="${c}" stroke-width="3.5"/>`,
  // saxophone
  (c) => `<path d="M18 6 L 30 11 L 36 44 C 38 55, 50 55, 51 44" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse cx="51" cy="43" rx="9" ry="6" fill="${c}"/><rect x="14" y="2" width="9" height="6" rx="2" fill="${DARK}"/>
    ${[[32, 20], [33.5, 28], [35, 36]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="${DARK}" fill-opacity="0.7"/>`).join('')}`,
  // headphones
  (c) => `<path d="M12 40 V32 A20 20 0 0 1 52 32 V40" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <rect x="8" y="36" width="12" height="20" rx="5" fill="${c}"/><rect x="44" y="36" width="12" height="20" rx="5" fill="${c}"/>`,
  // microphone
  (c) => `<rect x="22" y="4" width="20" height="34" rx="10" fill="${c}"/>
    <path d="M14 30 A18 18 0 0 0 50 30" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <rect x="29" y="46" width="6" height="10" fill="${c}"/><rect x="20" y="56" width="24" height="5" rx="2.5" fill="${c}"/>`,
  // speaker
  (c) => `<rect x="14" y="4" width="36" height="56" rx="6" fill="${c}"/><circle cx="32" cy="18" r="6" fill="#000" fill-opacity="0.35"/>
    <circle cx="32" cy="42" r="13" fill="#000" fill-opacity="0.35"/><circle cx="32" cy="42" r="5" fill="${c}"/>`,
  // equalizer bars
  (c) => `<rect x="8" y="30" width="8" height="28" rx="3" fill="${c}"/><rect x="20" y="14" width="8" height="44" rx="3" fill="${c}"/>
    <rect x="32" y="24" width="8" height="34" rx="3" fill="${c}"/><rect x="44" y="6" width="8" height="52" rx="3" fill="${c}"/>`,
];

// Decades in fun fonts. These are system fonts, each with fallbacks, since a favicon cannot
// load web fonts.
const DECADES: Array<[label: string, font: string, style: string]> = [
  ['70s', "'Cooper Black', 'Arial Rounded MT Bold', 'Chalkboard SE', sans-serif", 'normal'],
  ['80s', "Impact, 'Arial Black', Haettenschweiler, sans-serif", 'italic'],
  ['90s', "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', cursive", 'normal'],
  ['00s', "'Courier New', Courier, monospace", 'normal'],
];
for (const [label, font, style] of DECADES) {
  ICONS.push(
    (c) =>
      `<text x="32" y="36" text-anchor="middle" dominant-baseline="middle" font-family="${font}" font-style="${style}" font-weight="900" font-size="34" fill="${c}" stroke="${DARK}" stroke-opacity="0.5" stroke-width="1.5" paint-order="stroke" textLength="60" lengthAdjust="spacingAndGlyphs">${label}</text>`,
  );
}

export function faviconSvg(icon: Icon, color: string): string {
  const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${icon(color)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(body)}`;
}

export { ICONS, COLORS };

export function startFaviconCycle(intervalMs = 1800): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  let lastIcon = -1;
  let lastColor = -1;
  const tick = () => {
    let i: number;
    do i = Math.floor(Math.random() * ICONS.length);
    while (i === lastIcon);
    let k: number;
    do k = Math.floor(Math.random() * COLORS.length);
    while (k === lastColor);
    lastIcon = i;
    lastColor = k;
    link.href = faviconSvg(ICONS[i], COLORS[k]);
  };
  tick();
  setInterval(tick, intervalMs);
}
