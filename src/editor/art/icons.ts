// Inline 16x16 SVG icons for the art toolbar (original line glyphs, currentColor).
const PATHS = {
  pencil: '<path d="M3 13l.8-3.2L10.6 3l2.4 2.4-6.8 6.8z"/><path d="M9.2 4.4l2.4 2.4"/>',
  eraser: '<path d="M6.5 13.5h7"/><path d="M2.8 9.8l6-6 4.4 4.4-5.3 5.3H6.5z"/><path d="M5.6 7l4.4 4.4"/>',
  line: '<path d="M3 13L13 3"/><circle cx="3" cy="13" r="1.3"/><circle cx="13" cy="3" r="1.3"/>',
  rect: '<rect x="2.5" y="3.5" width="11" height="9"/>',
  ellipse: '<ellipse cx="8" cy="8" rx="5.5" ry="4.5"/>',
  fill: '<path d="M2.5 7.5l5-5 5 5-5 5z"/><path d="M2.5 7.5h10"/><path d="M13.5 10.5c0 1.2-.5 2.5-1 2.5s-1-1.3-1-2.5l1-1.5z"/>',
  eyedropper: '<path d="M11.8 2.6a1.6 1.6 0 012.3 2.3L12.3 6.7 9.6 4z"/><path d="M10.4 5.4l-6.6 6.6-.8 2 2-.8 6.6-6.6"/>',
  select: '<path stroke-dasharray="2 1.6" d="M2.5 2.5h11v11h-11z"/>',
  origin: '<path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4"/><circle cx="8" cy="8" r="1.6"/>',
  mirrorX: '<path d="M8 1.5v13" stroke-dasharray="1.5 1.5"/><path d="M6 4L2 8l4 4z"/><path d="M10 4l4 4-4 4z"/>',
  mirrorY: '<path d="M1.5 8h13" stroke-dasharray="1.5 1.5"/><path d="M4 6l4-4 4 4z"/><path d="M4 10l4 4 4-4z"/>',
  flipH: '<path d="M2 8h12"/><path d="M5 5L2 8l3 3M11 5l3 3-3 3"/>',
  flipV: '<path d="M8 2v12"/><path d="M5 5l3-3 3 3M5 11l3 3 3-3"/>',
  rotate: '<path d="M12.5 8A4.5 4.5 0 114 5.2"/><path d="M4 2v3.4h3.4"/>',
  clear: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
  onion: '<rect x="2" y="2" width="8" height="8" stroke-dasharray="1.5 1.2"/><rect x="6" y="6" width="8" height="8"/>',
  grid: '<path d="M2.5 2.5h11v11h-11zM6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11"/>',
  zoomIn: '<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3L14 14M5 7h4M7 5v4"/>',
  zoomOut: '<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3L14 14M5 7h4"/>',
  fit: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>',
  swap: '<path d="M4 3v7h7"/><path d="M9 8l2 2-2 2M2 5l2-2 2 2"/>',
  play: '<path d="M5 3l8 5-8 5z"/>',
  pause: '<path d="M5 3v10M11 3v10"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** An inline SVG icon element (stroke = currentColor). */
export function icon(name: IconName): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="qf-art-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}
