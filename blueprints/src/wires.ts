import { wireLayer, world } from './dom';
import { formatDegrees, PHASE_EPSILON, phaseColor } from './phase';
import type { QubitState } from './simulator';
import { editor, nodeById } from './state';
import type { Point } from './types';
import { centerOf } from './viewport';

/** Quantum input/output, classical input/output. */
export type PinKind = 'i' | 'o' | 'ci' | 'co';
type Side = 'l' | 'r' | 't' | 'b';

export function pinElement(nodeId: number, kind: PinKind, index: number): HTMLElement {
  const node = nodeById(nodeId);
  const pin = node?.el.querySelector<HTMLElement>(`[data-k="${kind}"][data-i="${index}"]`);
  if (!pin) throw new Error(`No ${kind} pin ${index} on node ${nodeId}`);
  return pin;
}

/** A horizontal S-curve from output point a to input point b. */
export function wirePath(a: Point, b: Point): string {
  const d = Math.max(40, Math.abs(b[0] - a[0]) / 2);
  return `M${a[0]},${a[1]}C${a[0] + d},${a[1]} ${b[0] - d},${b[1]} ${b[0]},${b[1]}`;
}

const DIRECTION: Record<Side, Point> = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };

/** A curve that leaves point a through edge `sa` and enters point b through edge `sb`. */
function edgePath(a: Point, sa: Side, b: Point, sb: Side): string {
  const d = Math.max(30, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
  const [ax, ay] = DIRECTION[sa], [bx, by] = DIRECTION[sb];
  return `M${a[0]},${a[1]}C${a[0] + ax * d},${a[1] + ay * d} ${b[0] + bx * d},${b[1] + by * d} ${b[0]},${b[1]}`;
}

/** Path of a wire being dragged from `pin` to the world point `p`. */
export function dragPath(pin: HTMLElement, p: Point): string {
  const at = centerOf(pin);
  const side = pin.dataset.side as Side | undefined;
  if (!side) return pin.dataset.k === 'o' ? wirePath(at, p) : wirePath(p, at);
  // The free end points back toward the pin.
  return pin.dataset.k === 'co' ? edgePath(at, side, p, side === 'b' ? 't' : 'l') : edgePath(p, side === 't' ? 'b' : 'r', at, side);
}

/** Tooltip for a classical wire: the value it carries, or the values over the measurement branches. */
function describeValue(values: number[] | undefined): string {
  if (!values?.length) return 'No value yet';
  const shown = values.map((v) => Number(v.toFixed(4)));
  return shown.length === 1 ? `Value ${shown[0]}` : `Per measurement branch: ${shown.join(' or ')}`;
}

function drawClassicalWires(): string {
  let svg = '';
  editor.cwires.forEach((w, k) => {
    const from = pinElement(w.a, 'co', w.ai), to = pinElement(w.b, 'ci', w.bi);
    const d = edgePath(centerOf(from), from.dataset.side as Side, centerOf(to), to.dataset.side as Side);
    svg +=
      `<g class="cw" data-c="${k}"><title>${describeValue(editor.sim?.classical.get(`${w.a}:${w.ai}`))}</title>` +
      `<path class="hit" d="${d}"/><path class="cln" d="${d}"/></g>`;
  });
  return svg;
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
  svg += drawClassicalWires();
  if (editor.pendingWire) svg += `<path class="tmp" d="${editor.pendingWire}"/>`;
  wireLayer.innerHTML = svg;

  world.querySelectorAll('.pin,.cpin').forEach((p) => p.classList.remove('on', 'ent'));
  for (const w of editor.wires) {
    pinElement(w.a, 'o', w.ai).classList.add('on');
    pinElement(w.b, 'i', w.bi).classList.add('on');
  }
  for (const w of editor.cwires) {
    pinElement(w.a, 'co', w.ai).classList.add('on');
    pinElement(w.b, 'ci', w.bi).classList.add('on');
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
