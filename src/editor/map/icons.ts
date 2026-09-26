// Original line icons for the map tab (16x16 grid, currentColor), in the same
// style as the shell's chrome icons.
const SVG_NS = 'http://www.w3.org/2000/svg';

interface IconDef {
  /** Stroked paths. */
  stroke?: string;
  /** Filled paths. */
  fill?: string;
}

const ICONS = {
  pencil: { stroke: 'M3 13l.8-3.2 7-7 2.4 2.4-7 7zM9.4 4.2l2.4 2.4' },
  rect: { stroke: 'M2.5 3.5h11v9h-11z', fill: 'M5 6h6v4H5z' },
  fill: {
    stroke: 'M2.8 8.6 7.4 4l5 5-4.6 4.6zM7.4 4 5.8 2.4',
    fill: 'M12.6 10.4c.8 1.2 1.2 1.9 1.2 2.4a1.2 1.2 0 0 1-2.4 0c0-.5.4-1.2 1.2-2.4z',
  },
  eraser: { stroke: 'M6.2 13.5h7.3M2.8 10.2l6.5-6.5 3.9 3.9-5.9 5.9H6.1z', fill: 'M2.8 10.2 5.3 7.7l3.9 3.9-1.9 1.9H6.1z' },
  eyedropper: {
    stroke: 'M3 13l1-3 6.3-6.3 2 2L6 12z',
    fill: 'M10.9 2.1a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3l-1.2 1.2-3-3z',
  },
  select: { stroke: 'M2.5 5V2.5H5M7 2.5h2M11 2.5h2.5V5M13.5 7v2M13.5 11v2.5H11M9 13.5H7M5 13.5H2.5V11M2.5 9V7' },
  terrain: { stroke: 'M1.5 13 6 5.5l2.5 4 2-3 4 6.5z' },
  entity: { stroke: 'M8 7a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 8 7zM3.5 13.5c.4-2.8 2.2-4.3 4.5-4.3s4.1 1.5 4.5 4.3' },
  eye: { stroke: 'M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z', fill: 'M6.3 8a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0z' },
  eyeOff: { stroke: 'M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8zM2.5 13.5l11-11' },
  grid: { stroke: 'M2.5 2.5h11v11h-11zM6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11' },
  collision: { stroke: 'M2.5 2.5h11v11h-11zM2.5 7.5l5-5M2.5 12.5l10-10M7.5 13.5l6-6' },
  neighbours: { stroke: 'M5.5 5.5h5v5h-5zM1.5 6.8h2.5M12 6.8h2.5M1.5 9.2h2.5M12 9.2h2.5M6.8 1.5V4M9.2 1.5V4M6.8 12v2.5M9.2 12v2.5' },
  zoomIn: { stroke: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14M4.8 7h4.4M7 4.8v4.4' },
  zoomOut: { stroke: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14M4.8 7h4.4' },
  fit: { stroke: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10' },
  plus: { stroke: 'M8 3v10M3 8h10' },
  trash: { stroke: 'M2.5 4.2h11M6 4.2V2.5h4v1.7M4.3 4.2l.7 9.3h6l.7-9.3M6.7 6.5v4.5M9.3 6.5v4.5' },
  edit: { stroke: 'M3 13l.8-3.2 7-7 2.4 2.4-7 7z' },
  up: { stroke: 'M4 10l4-4 4 4' },
  down: { stroke: 'M4 6l4 4 4-4' },
  chevron: { stroke: 'M6 4l4 4-4 4' },
  play: { fill: 'M5 3.2v9.6L12.6 8z' },
  stop: { fill: 'M4 4h8v8H4z' },
  walls: { stroke: 'M2 3.5h12v9H2zM2 6.5h12M2 9.5h12M6 3.5v3M10 6.5v3M6 9.5v3' },
  target: { stroke: 'M8 12A4 4 0 1 0 8 4a4 4 0 0 0 0 8zM8 1v3M8 12v3M1 8h3M12 8h3' },
  flag: { stroke: 'M4 14V2.5', fill: 'M4.5 3h7.5l-2 2.5 2 2.5H4.5z' },
  warp: { stroke: 'M8 13.5A5.5 5.5 0 1 1 13.5 8M8 10.5A2.5 2.5 0 1 1 10.5 8' },
  copy: { stroke: 'M5.5 5.5h8v8h-8zM3 10.5V3h7.5' },
  search: { stroke: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14' },
  keyboard: { stroke: 'M1.5 4.5h13v7h-13zM4 7h.5M6.5 7H7M9 7h.5M11.5 7h.5M4.5 9.5h7' },
  more: { fill: 'M2.6 8a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0zM6.7 8a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0zM10.8 8a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0z' },
} satisfies Record<string, IconDef>;

export type MapIcon = keyof typeof ICONS;

/** An inline SVG icon (decorative: aria-hidden). */
export function mapIcon(name: MapIcon, size = 16): SVGSVGElement {
  const def: IconDef = ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'qf-map-icon');
  if (def.fill) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', def.fill);
    p.setAttribute('fill', 'currentColor');
    svg.appendChild(p);
  }
  if (def.stroke) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', def.stroke);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.4');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
  }
  return svg;
}
