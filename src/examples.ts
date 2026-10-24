import { defs, groupNodes, pinLabels, type CustomDef } from './custom';
import { GATES } from './gates';
import type { SimNode } from './simulator';
import type { GateType, NodeData, Wire } from './types';

/**
 * [gate, ...qubit indices, optional parameter]. A gate written "@id" is the
 * custom gate with that id from the example's `gates`.
 */
export type Op = [GateType | `@${string}`, ...number[]];

/** A custom gate built from an op list; lane k is qubit k of the ops. */
export interface GateSpec {
  id: string;
  name: string;
  lanes: number;
  ops: Op[];
}

export interface Example {
  name: string;
  description: string;
  qubits: number;
  init?: number[];
  /** Custom gates the example uses. */
  gates?: GateSpec[];
  ops: Op[];
}

export const EXAMPLES: Example[] = [
  { name: 'Bell state', description: '2 qubits', qubits: 2, ops: [['H', 0], ['CNOT', 0, 1]] },
  { name: 'GHZ state', description: '3 qubits', qubits: 3, ops: [['H', 0], ['CNOT', 0, 1], ['CNOT', 1, 2]] },
  {
    name: 'Deutsch',
    description: 'is f constant or balanced? oracle f(x) = x',
    qubits: 2,
    // q0 is x, q1 the |1⟩ ancilla that turns f(x) into a phase.
    init: [0, 1],
    gates: [{ id: 'ex-deutsch-oracle', name: 'Oracle f(x)=x', lanes: 2, ops: [['CNOT', 0, 1]] }],
    ops: [['H', 0], ['H', 1], ['@ex-deutsch-oracle', 0, 1], ['H', 0], ['H', 1], ['M', 0]],
  },
  {
    name: 'Deutsch–Jozsa',
    description: '3 qubits + ancilla, balanced oracle (parity)',
    qubits: 4,
    init: [0, 0, 0, 1],
    gates: [
      {
        id: 'ex-dj-oracle',
        name: 'Oracle parity',
        lanes: 4,
        ops: [['CNOT', 0, 3], ['CNOT', 1, 3], ['CNOT', 2, 3]],
      },
    ],
    ops: [
      ['H', 0], ['H', 1], ['H', 2], ['H', 3], ['@ex-dj-oracle', 0, 1, 2, 3],
      ['H', 0], ['H', 1], ['H', 2], ['H', 3], ['M', 0], ['M', 1], ['M', 2],
    ],
  },
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
  def?: string;
}

/**
 * Turns an op list into a circuit graph (ids start at 1): one Qubit node per
 * qubit, then one node per op, each wired after the previous block on its
 * qubits. Custom gates used by the ops must already be registered.
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

  for (const [gate, ...args] of ops) {
    const custom = gate.startsWith('@') ? gate.slice(1) : undefined;
    const type: GateType = custom ? 'Custom' : (gate as GateType);
    const arity = pinLabels({ type, def: custom }).ins.length;
    const qs = args.slice(0, arity);
    const param = args[arity];
    const node: GraphNode = { id: ++id, type, p: param ?? (GATES[type].param ? 0.5 : 0), init: 0, row: qs[0] };
    if (custom) node.def = custom;
    nodes.push(node);
    qs.forEach((q, k) => {
      wires.push({ a: last[q][0], ai: last[q][1], b: id, bi: k });
      last[q] = [id, k];
    });
  }

  return { nodes, wires };
}

/** Builds a custom gate definition from an op list, with lane k being qubit k. */
export function defFromOps(spec: GateSpec): CustomDef {
  const graph = opsToGraph(spec.lanes, spec.ops);
  let x = 0;
  const nodes: NodeData[] = graph.nodes.map(({ row, ...n }) => ({ ...n, x: n.type === 'Q' ? 0 : (x += 150), y: row * 110 }));
  const rowOf = new Map(graph.nodes.map((n) => [n.id, n.row]));
  // Every lane starts at one of the qubits, so order lanes by the qubit feeding them.
  const laneOf = (node: NodeData, pin: number) => {
    const w = graph.wires.find((w) => w.b === node.id && w.bi === pin);
    return w ? rowOf.get(w.a)! : 0;
  };
  const { def } = groupNodes(nodes, graph.wires, spec.name, laneOf)!;
  return {
    ...def,
    id: spec.id,
    nodes: def.nodes.map((n) => (n.def === def.id ? { ...n, def: spec.id } : n)),
  };
}

/** Registers (or resets) the custom gates an example uses. */
export function registerExampleGates(example: Example): void {
  for (const spec of example.gates ?? []) defs.set(spec.id, defFromOps(spec));
}
