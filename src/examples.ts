import { GATES } from './gates';
import type { SimNode } from './simulator';
import type { GateType, Wire } from './types';

/** [gate, ...qubit indices, optional parameter]. */
export type Op = [GateType, ...number[]];

export interface Example {
  name: string;
  description: string;
  qubits: number;
  init?: number[];
  ops: Op[];
}

export const EXAMPLES: Example[] = [
  { name: 'Bell state', description: '2 qubits', qubits: 2, ops: [['H', 0], ['CNOT', 0, 1]] },
  { name: 'GHZ state', description: '3 qubits', qubits: 3, ops: [['H', 0], ['CNOT', 0, 1], ['CNOT', 1, 2]] },
  { name: 'Uniform superposition', description: '3 qubits', qubits: 3, ops: [['H', 0], ['H', 1], ['H', 2]] },
  {
    name: 'Grover search',
    description: '2 qubits, marks |11⟩',
    qubits: 2,
    ops: [
      ['H', 0], ['H', 1], ['CZ', 0, 1], ['H', 0], ['H', 1], ['X', 0], ['X', 1],
      ['CZ', 0, 1], ['X', 0], ['X', 1], ['H', 0], ['H', 1], ['M', 0], ['M', 1],
    ],
  },
  {
    name: 'Quantum Fourier transform',
    description: '3 qubits',
    qubits: 3,
    init: [1, 0, 1],
    ops: [['H', 0], ['CP', 1, 0, 0.5], ['CP', 2, 0, 0.25], ['H', 1], ['CP', 2, 1, 0.5], ['H', 2], ['SWAP', 0, 2]],
  },
  {
    name: 'Mid-circuit measurement',
    description: 'collapse, then continue',
    qubits: 1,
    ops: [['H', 0], ['M', 0, 1], ['H', 0]],
  },
];

/** A node of a generated circuit, with the qubit lane it is laid out on. */
export interface GraphNode extends SimNode {
  row: number;
}

/**
 * Turns an op list into a circuit graph (ids start at 1): one Qubit node per
 * qubit, then one node per op, each wired after the previous block on its qubits.
 */
export function opsToGraph(qubits: number, ops: Op[], init: number[] = []): { nodes: GraphNode[]; wires: Wire[] } {
  const nodes: GraphNode[] = [];
  const wires: Wire[] = [];
  const last: [number, number][] = [];
  let id = 0;

  for (let q = 0; q < qubits; q++) {
    nodes.push({ id: ++id, type: 'Q', p: 0, init: init[q] || 0, row: q });
    last[q] = [id, 0];
  }

  for (const [type, ...args] of ops) {
    const def = GATES[type];
    const qs = args.slice(0, def.ins.length);
    const param = args[def.ins.length];
    nodes.push({ id: ++id, type, p: param ?? (def.param ? 0.5 : 0), init: 0, row: qs[0] });
    qs.forEach((q, k) => {
      wires.push({ a: last[q][0], ai: last[q][1], b: id, bi: k });
      last[q] = [id, k];
    });
  }

  return { nodes, wires };
}
