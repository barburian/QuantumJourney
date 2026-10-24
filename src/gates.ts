import type { GateDef, GateType } from './types';

const GREEN = '#0f9d74';
const PURPLE = '#6b4df0';
const ORANGE = '#c9690a';
const BLUE = '#2f6fed';
const PINK = '#c2255c';
const TEAL = '#0e7490';

const single = (): GateDef => ({ color: PURPLE, kind: 'sq', ins: [''], outs: [''] });
const rotation = (): GateDef => ({ color: ORANGE, kind: 'rot', param: true, ins: [''], outs: [''] });
const twoQubit = (a: string, b: string, extra: Partial<GateDef> = {}): GateDef => ({
  color: BLUE,
  kind: 'full',
  ins: [a, b],
  outs: [a, b],
  ...extra,
});

export const GATES: Record<GateType, GateDef> = {
  Q: { color: GREEN, kind: 'q', ins: [], outs: [''] },
  H: single(),
  X: single(),
  Y: single(),
  Z: single(),
  S: single(),
  T: single(),
  Rx: rotation(),
  Ry: rotation(),
  Rz: rotation(),
  P: rotation(),
  CNOT: twoQubit('control', 'target'),
  CZ: twoQubit('a', 'b'),
  SWAP: twoQubit('a', 'b'),
  CP: twoQubit('control', 'target', { param: true }),
  M: { color: PINK, kind: 'full', ins: [''], outs: [''], measure: true },
  Probe: { color: TEAL, kind: 'full', ins: [''], outs: [''], probe: true },
};

export const isGateType = (t: string): t is GateType => Object.hasOwn(GATES, t);

export const PALETTE_GROUPS: [title: string, gates: GateType[]][] = [
  ['Qubit', ['Q']],
  ['Gates', ['H', 'X', 'Y', 'Z', 'S', 'T']],
  ['Rotations', ['Rx', 'Ry', 'Rz', 'P']],
  ['Two-qubit', ['CNOT', 'CZ', 'SWAP', 'CP']],
  ['Readout', ['M', 'Probe']],
];

const LABELS: Partial<Record<GateType, string>> = { Q: 'Qubit', M: 'Measure' };
export const gateLabel = (t: GateType): string => LABELS[t] ?? t;

/** Initial qubit states, indexed by `NodeData.init`, and the gates that prepare each from |0⟩. */
export const INITIAL_STATES = ['|0⟩', '|1⟩', '|+⟩', '|−⟩'];
export const INITIAL_STATE_GATES: GateType[][] = [[], ['X'], ['H'], ['X', 'H']];
