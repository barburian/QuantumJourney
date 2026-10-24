import { canvas, world } from './dom';
import { editor } from './state';
import type { Point } from './types';

const GRID = 24;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;

/** Pan offset (x, y) in screen pixels and zoom factor. */
export const viewport = { zoom: 1, x: 0, y: 0 };

/** Called after every pan or zoom, for overlays that follow the circuit. */
export const viewListeners: (() => void)[] = [];

export function applyView(): void {
  const { zoom, x, y } = viewport;
  world.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
  canvas.style.backgroundPosition = `${x}px ${y}px`;
  canvas.style.backgroundSize = `${GRID * zoom}px ${GRID * zoom}px`;
  for (const listener of viewListeners) listener();
}

/** Converts a pointer position to world coordinates. */
export function toWorld(e: { clientX: number; clientY: number }): Point {
  const r = world.getBoundingClientRect();
  return [(e.clientX - r.left) / viewport.zoom, (e.clientY - r.top) / viewport.zoom];
}

/** Centre of an element, in world coordinates. */
export function centerOf(el: Element): Point {
  const r = el.getBoundingClientRect();
  const w = world.getBoundingClientRect();
  return [(r.left + r.width / 2 - w.left) / viewport.zoom, (r.top + r.height / 2 - w.top) / viewport.zoom];
}

/** Zooms by `factor`, keeping the screen point (cx, cy) fixed. */
export function zoomAt(cx: number, cy: number, factor: number): void {
  const r = canvas.getBoundingClientRect();
  const px = cx - r.left, py = cy - r.top;
  const { zoom } = viewport;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
  viewport.x = px - ((px - viewport.x) * next) / zoom;
  viewport.y = py - ((py - viewport.y) * next) / zoom;
  viewport.zoom = next;
  applyView();
}

export function canvasCenter(): Point {
  const r = canvas.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

/** Centres the circuit and zooms so that it fits (never above 100%). */
export function fitToContent(): void {
  const { nodes } = editor;
  if (!nodes.length) {
    viewport.zoom = 1;
    viewport.x = viewport.y = 0;
    applyView();
    return;
  }
  const x0 = Math.min(...nodes.map((n) => n.x));
  const y0 = Math.min(...nodes.map((n) => n.y));
  const x1 = Math.max(...nodes.map((n) => n.x + n.el.offsetWidth));
  const y1 = Math.max(...nodes.map((n) => n.y + n.el.offsetHeight));
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const zoom = Math.max(0.35, Math.min(1, (cw - 60) / (x1 - x0), (ch - 60) / (y1 - y0)));
  viewport.zoom = zoom;
  viewport.x = (cw - (x1 - x0) * zoom) / 2 - x0 * zoom;
  viewport.y = (ch - (y1 - y0) * zoom) / 2 - y0 * zoom;
  applyView();
}
