import type { GateDef, GateType, NodeData } from './types';

const GREEN = '#0f9d74';
const PURPLE = '#6b4df0';
const ORANGE = '#c9690a';
const BLUE = '#2f6fed';
const PINK = '#c2255c';
const TEAL = '#0e7490';
const SLATE = '#4f5d75';
const GRAPHITE = '#3b4252';
const AMBER = '#b45309';

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
  // Pins of these depend on the custom gate definition; see pinLabels() in custom.ts.
  Custom: { color: SLATE, kind: 'full', ins: [], outs: [] },
  In: { color: GRAPHITE, kind: 'full', ins: [], outs: [] },
  Out: { color: GRAPHITE, kind: 'full', ins: [], outs: [] },
  // Classical blocks: no qubits, only classical pins.
  Num: { color: AMBER, kind: 'cl', ins: [], outs: [] },
  Math: { color: AMBER, kind: 'cl', ins: [], outs: [] },
  Obs: { color: AMBER, kind: 'cl', ins: [], outs: [] },
  Opt: { color: AMBER, kind: 'cl', ins: [], outs: [] },
};

export const isGateType = (t: string): t is GateType => Object.hasOwn(GATES, t);

export const PALETTE_GROUPS: [title: string, gates: GateType[]][] = [
  ['Qubit', ['Q']],
  ['Gates', ['H', 'X', 'Y', 'Z', 'S', 'T']],
  ['Rotations', ['Rx', 'Ry', 'Rz', 'P']],
  ['Two-qubit', ['CNOT', 'CZ', 'SWAP', 'CP']],
  ['Readout', ['M', 'Probe']],
  ['Classical', ['Num', 'Math', 'Obs', 'Opt']],
];

/** Operations of a Math block. Logic treats any non-zero value as true and gives 0 or 1. */
export const MATH_OPS = ['+', '−', '×', '÷', 'xor', 'and', 'or', 'not'] as const;

export function mathOp(op: string | undefined, a: number, b: number): number {
  switch (op) {
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return a / b;
    case 'xor': return Number(!!a !== !!b);
    case 'and': return Number(!!a && !!b);
    case 'or': return Number(!!a || !!b);
    case 'not': return Number(!a);
    default: return a + b;
  }
}

/**
 * Classical pins of a block. Gates that take an angle have a θ input (in
 * multiples of π, overriding the typed value); conditional gates an "if"
 * input; measurements a bit output.
 */
export function classicalPins(
  node: Pick<NodeData, 'type' | 'cond' | 'op' | 'vals'>,
): { ins: string[]; outs: string[] } {
  switch (node.type) {
    case 'Num': return { ins: [], outs: ['value'] };
    case 'Math': return { ins: node.op === 'not' ? ['a'] : ['a', 'b'], outs: ['out'] };
    case 'Obs': return { ins: [], outs: ['⟨H⟩'] };
    case 'Opt': return { ins: ['cost'], outs: (node.vals ?? []).map((_, i) => `θ${i}`) };
    case 'M': return { ins: [], outs: ['bit'] };
    case 'Q': case 'In': case 'Out': case 'Probe': case 'Custom': return { ins: [], outs: [] };
    default: {
      const ins = GATES[node.type].param ? ['θ'] : [];
      if (node.cond) ins.push('if');
      return { ins, outs: [] };
    }
  }
}

/** True if a block can be made conditional by wiring a classical value to it. */
export const canBeConditional = (type: GateType): boolean =>
  !['Q', 'In', 'Out', 'Probe', 'Custom', 'M'].includes(type) && GATES[type].kind !== 'cl';

const LABELS: Partial<Record<GateType, string>> = {
  Q: 'Qubit', M: 'Measure', In: 'Inputs', Out: 'Outputs', Num: 'Number', Math: 'Math',
  Obs: 'Expectation', Opt: 'Optimizer',
};
export const gateLabel = (t: GateType): string => LABELS[t] ?? t;

/** Initial qubit states, indexed by `NodeData.init`, and the gates that prepare each from |0⟩. */
export const INITIAL_STATES = ['|0⟩', '|1⟩', '|+⟩', '|−⟩'];
export const INITIAL_STATE_GATES: GateType[][] = [[], ['X'], ['H'], ['X', 'H']];
