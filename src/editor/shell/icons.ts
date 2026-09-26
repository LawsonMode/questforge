// Small original line icons (16x16 grid, currentColor) for the app chrome.
const SVG_NS = 'http://www.w3.org/2000/svg';

interface IconDef {
  /** Stroked paths. */
  stroke?: string;
  /** Filled paths. */
  fill?: string;
}

const ICONS = {
  play: { fill: 'M5 3.2v9.6L12.6 8z' },
  stop: { fill: 'M4 4h8v8H4z' },
  undo: { stroke: 'M6 3.5 2.8 6.7 6 9.9M3 6.7h6.6a3.4 3.4 0 0 1 0 6.8H7' },
  redo: { stroke: 'M10 3.5l3.2 3.2L10 9.9M13 6.7H6.4a3.4 3.4 0 0 0 0 6.8H9' },
  download: { stroke: 'M8 2.5v8M4.8 7.3 8 10.5l3.2-3.2M3 13.5h10' },
  upload: { stroke: 'M8 10.5v-8M4.8 5.7 8 2.5l3.2 3.2M3 13.5h10' },
  help: { stroke: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM6.2 6.3a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3v.3', fill: 'M7.2 11h1.6v1.6H7.2z' },
  back: { stroke: 'M13 8H3.2M7 4 3 8l4 4' },
  map: { stroke: 'M2 4.2 6 2.5l4 1.7 4-1.7v9.3L10 13.5l-4-1.7-4 1.7zM6 2.5v9.3M10 4.2v9.3' },
  art: { stroke: 'M2.5 2.5h5v5h-5zM8.5 8.5h5v5h-5z', fill: 'M8.5 2.5h5v5h-5zM2.5 8.5h5v5h-5z' },
  dialogue: { stroke: 'M2.5 3h11v7.5H7.5L4.5 13v-2.5h-2z' },
  project: { stroke: 'M2.5 4h11M2.5 8h11M2.5 12h11', fill: 'M4.5 2.5h2v3h-2zM9.5 6.5h2v3h-2zM6 10.5h2v3H6z' },
  copy: { stroke: 'M5.5 5.5h8v8h-8zM3 10.5V3h7.5' },
  trash: { stroke: 'M2.5 4.2h11M6 4.2V2.5h4v1.7M4.3 4.2l.7 9.3h6l.7-9.3M6.7 6.5v4.5M9.3 6.5v4.5' },
  edit: { stroke: 'M3 13l.8-3.2 7-7 2.4 2.4-7 7zM9.4 4.2l2.4 2.4' },
  plus: { stroke: 'M8 3v10M3 8h10' },
  check: { stroke: 'M3 8.5l3 3 7-7' },
  warning: { stroke: 'M8 2.2l6.3 11.3H1.7zM8 6.3v3.5', fill: 'M7.2 11h1.6v1.5H7.2z' },
  error: { stroke: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4' },
  target: { stroke: 'M8 12A4 4 0 1 0 8 4a4 4 0 0 0 0 8zM8 1v3M8 12v3M1 8h3M12 8h3' },
  sword: { fill: 'M7 1h2v9H7zM4 10h8v2H4zM7 12h2v3H7z' },
  music: { stroke: 'M6 12V3.5l7-1.5v8.5', fill: 'M2.5 12a2 1.6 0 1 0 4 0 2 1.6 0 1 0-4 0zM9.5 10.5a2 1.6 0 1 0 4 0 2 1.6 0 1 0-4 0z' },
  close: { stroke: 'M4 4l8 8M12 4l-8 8' },
  sound: { stroke: 'M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.8a6 6 0 0 1 0 8.4', fill: 'M2 6h2.6L8.4 3v10L4.6 10H2z' },
  mute: { stroke: 'M10.5 6l3.5 4M14 6l-3.5 4', fill: 'M2 6h2.6L8.4 3v10L4.6 10H2z' },
} satisfies Record<string, IconDef>;

/** Names of the available icons. */
export type IconName = keyof typeof ICONS;

/** An inline SVG icon (decorative: aria-hidden). */
export function icon(name: IconName, size = 16): SVGSVGElement {
  const def: IconDef = ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('qf-icon');
  if (def.stroke) svg.appendChild(path(def.stroke, 'none', 'currentColor'));
  if (def.fill) svg.appendChild(path(def.fill, 'currentColor', 'none'));
  return svg;
}

function path(d: string, fill: string, stroke: string): SVGPathElement {
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', fill);
  if (stroke !== 'none') {
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  }
  return p;
}
