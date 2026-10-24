import { wireLayer, world } from './dom';
import { editor, nodeById } from './state';
import type { Point } from './types';
import { centerOf } from './viewport';

export type PinKind = 'i' | 'o';

export function pinElement(nodeId: number, kind: PinKind, index: number): HTMLElement {
  const node = nodeById(nodeId);
  const pin = node?.el.querySelector<HTMLElement>(`.pin[data-k="${kind}"][data-i="${index}"]`);
  if (!pin) throw new Error(`No ${kind === 'i' ? 'input' : 'output'} pin ${index} on node ${nodeId}`);
  return pin;
}

/** A horizontal S-curve from output point a to input point b. */
export function wirePath(a: Point, b: Point): string {
  const d = Math.max(40, Math.abs(b[0] - a[0]) / 2);
  return `M${a[0]},${a[1]}C${a[0] + d},${a[1]} ${b[0] - d},${b[1]} ${b[0]},${b[1]}`;
}

export function drawWires(): void {
  let svg = '';
  editor.wires.forEach((w, k) => {
    const d = wirePath(centerOf(pinElement(w.a, 'o', w.ai)), centerOf(pinElement(w.b, 'i', w.bi)));
    svg += `<g class="w" data-k="${k}"><path class="hit" d="${d}"/><path class="ln" d="${d}"/></g>`;
  });
  if (editor.pendingWire) svg += `<path class="tmp" d="${editor.pendingWire}"/>`;
  wireLayer.innerHTML = svg;

  world.querySelectorAll('.pin').forEach((p) => p.classList.remove('on'));
  for (const w of editor.wires) {
    pinElement(w.a, 'o', w.ai).classList.add('on');
    pinElement(w.b, 'i', w.bi).classList.add('on');
  }
}
