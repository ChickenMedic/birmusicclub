// Animated favicon: every couple of seconds the tab icon becomes a different music-themed
// symbol in a different colour, on a transparent background. Browsers that ignore dynamic favicons (Safari) keep the
// static /favicon.svg.

const COLORS = ['#1db954', '#ff4fa3', '#4f8dff', '#b06cff', '#ffd93d', '#ff7a3d', '#3de0ff', '#ff5c5c'];

// Each icon is drawn in a 64x64 box; `c` is the accent colour.
const ICONS: Array<(c: string) => string> = [
  // single note
  (c) => `<ellipse cx="24" cy="46" rx="9" ry="7" fill="${c}"/><rect x="30" y="12" width="4" height="34" fill="${c}"/>
    <path d="M34 12 C 44 14, 50 20, 48 30 C 46 24, 40 22, 34 22 Z" fill="${c}"/>`,
  // beamed pair of notes
  (c) => `<ellipse cx="18" cy="48" rx="8" ry="6" fill="${c}"/><ellipse cx="44" cy="44" rx="8" ry="6" fill="${c}"/>
    <rect x="23" y="16" width="4" height="32" fill="${c}"/><rect x="49" y="12" width="4" height="32" fill="${c}"/>
    <path d="M23 16 L53 12 L53 20 L23 24 Z" fill="${c}"/>`,
  // disco ball
  (c) => `<rect x="31" y="2" width="2" height="7" fill="${c}"/><circle cx="32" cy="35" r="24" fill="#8d99a8"/>
    ${[...Array(5)].map((_, i) => `<line x1="8" y1="${17 + i * 9}" x2="56" y2="${17 + i * 9}" stroke="#2a2f3a" stroke-width="1.5"/>`).join('')}
    ${[...Array(5)].map((_, i) => `<line x1="${14 + i * 9}" y1="11" x2="${14 + i * 9}" y2="59" stroke="#2a2f3a" stroke-width="1.5"/>`).join('')}
    <circle cx="32" cy="35" r="24" fill="none" stroke="${c}" stroke-width="3"/><circle cx="23" cy="26" r="5" fill="#fff" opacity="0.8"/>`,
  // vinyl record
  (c) => `<circle cx="32" cy="32" r="28" fill="${c}"/><circle cx="32" cy="32" r="22" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="1.5"/>
    <circle cx="32" cy="32" r="16" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="1.5"/><circle cx="32" cy="32" r="9" fill="#fff"/><circle cx="32" cy="32" r="2" fill="${c}"/>`,
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

function svg(icon: (c: string) => string, color: string): string {
  const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${icon(color)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(body)}`;
}

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
    link.href = svg(ICONS[i], COLORS[k]);
  };
  tick();
  setInterval(tick, intervalMs);
}
