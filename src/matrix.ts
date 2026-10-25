/* The unitary matrix of a block, worked out by simulating it on every basis state. */
import { pinLabels, simulateCircuit } from './custom';
import { GATES } from './gates';
import type { NodeData, Wire } from './types';

export interface Complex {
  re: number;
  im: number;
}

/** Blocks that are not gates and so have no matrix. */
export const hasMatrix = (node: Pick<NodeData, 'type'>): boolean =>
  !['Q', 'In', 'Out', 'M', 'Probe'].includes(node.type) && GATES[node.type].kind !== 'cl';

/**
 * The matrix of a block, as rows of columns: entry [r][c] is ⟨r|U|c⟩. Basis
 * index bit k is the qubit on the block's pin k (pin 0 is the least
 * significant bit, as in the results). Null when the block isn't unitary,
 * i.e. it collapses a measurement.
 */
export function blockMatrix(block: Pick<NodeData, 'type' | 'p' | 'def' | 'dagger' | 'ctrl' | 'rep'>): Complex[][] | null {
  const lanes = pinLabels(block).ins.length;
  const size = 1 << lanes;
  const id = lanes + 1;
  const wires: Wire[] = Array.from({ length: lanes }, (_, k) => ({ a: k + 1, ai: 0, b: id, bi: k }));
  const rows: Complex[][] = Array.from({ length: size }, () => []);

  for (let col = 0; col < size; col++) {
    const nodes: NodeData[] = Array.from({ length: lanes }, (_, k) => ({
      id: k + 1, type: 'Q', x: 0, y: 0, p: 0, init: (col >> k) & 1,
    }));
    nodes.push({ ...block, id, x: 0, y: 0, init: 0 });
    const { state } = simulateCircuit(nodes, wires);
    if (!state) return null;
    for (let row = 0; row < size; row++) rows[row][col] = { re: state.re[row], im: state.im[row] };
  }
  return rows;
}

/** Reverses the bit order of every index: pin 0 becomes the most significant bit. */
export function reverseQubitOrder(m: Complex[][]): Complex[][] {
  const bits = Math.log2(m.length);
  const flip = (i: number) => {
    let r = 0;
    for (let b = 0; b < bits; b++) if ((i >> b) & 1) r |= 1 << (bits - 1 - b);
    return r;
  };
  return m.map((_, r) => m[flip(r)].map((_, c) => m[flip(r)][flip(c)]));
}

const clean = (v: number) => (Math.abs(v) < 5e-4 ? 0 : v);
const num = (v: number) => {
  const s = Number(v.toFixed(3)).toString();
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
};

/** Short text for a complex number: 0, 1, −i, 0.707, 0.5+0.5i, … */
export function formatComplex({ re, im }: Complex): string {
  const r = clean(re), i = clean(im);
  if (!i) return num(r);
  const imag = Math.abs(i) === 1 ? 'i' : `${num(Math.abs(i))}i`;
  if (!r) return i < 0 ? `−${imag}` : imag;
  return `${num(r)}${i < 0 ? '−' : '+'}${imag}`;
}
