import { wireLayer, world } from './dom';
import { formatDegrees, PHASE_EPSILON, phaseColor } from './phase';
import type { QubitState } from './simulator';
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

/** Thickness grows with P(1); colour is the phase, faded toward the plain wire colour near the poles. */
function liveStyle(s: QubitState): string {
  const [x, y] = s.bloch;
  const transverse = Math.min(1, Math.hypot(x, y));
  const color =
    transverse < PHASE_EPSILON
      ? 'var(--wire)'
      : `color-mix(in oklab, ${phaseColor(Math.atan2(y, x))} ${Math.round(transverse * 100)}%, var(--wire))`;
  return `--wc:${color};--ww:${(2 + 4 * s.p1).toFixed(2)}px`;
}

function describe(s: QubitState): string {
  const [x, y] = s.bloch;
  const phase = Math.hypot(x, y) < PHASE_EPSILON ? '' : ` · phase ${formatDegrees(Math.atan2(y, x))}`;
  return `q${s.qubit} · P(1) ${(s.p1 * 100).toFixed(1)}%${phase}${s.entangled ? ' · entangled' : ''}`;
}

export function drawWires(): void {
  let svg = '';
  editor.wires.forEach((w, k) => {
    const d = wirePath(centerOf(pinElement(w.a, 'o', w.ai)), centerOf(pinElement(w.b, 'i', w.bi)));
    const state = editor.liveWires ? editor.sim?.pins.get(`${w.a}:${w.ai}`) : undefined;
    if (!state) {
      svg += `<g class="w" data-k="${k}"><path class="hit" d="${d}"/><path class="ln" d="${d}"/></g>`;
      return;
    }
    svg +=
      `<g class="w live${state.entangled ? ' ent' : ''}" data-k="${k}" style="${liveStyle(state)}">` +
      `<title>${describe(state)}</title><path class="hit" d="${d}"/>` +
      (state.entangled ? `<path class="glow" d="${d}"/>` : '') +
      `<path class="ln" d="${d}"/><path class="flow" d="${d}"/></g>`;
  });
  if (editor.pendingWire) svg += `<path class="tmp" d="${editor.pendingWire}"/>`;
  wireLayer.innerHTML = svg;

  world.querySelectorAll('.pin').forEach((p) => p.classList.remove('on', 'ent'));
  for (const w of editor.wires) {
    pinElement(w.a, 'o', w.ai).classList.add('on');
    pinElement(w.b, 'i', w.bi).classList.add('on');
  }

  // Entanglement also shows on output pins, so it is visible at the end of a circuit.
  if (editor.liveWires && editor.sim) {
    for (const node of editor.nodes) {
      node.el.querySelectorAll<HTMLElement>('.pin[data-k="o"]').forEach((pin) => {
        if (editor.sim!.pins.get(`${node.id}:${pin.dataset.i}`)?.entangled) pin.classList.add('ent');
      });
    }
  }
}
