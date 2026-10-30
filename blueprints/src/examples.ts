import { defs, groupNodes, pinLabels, type CustomDef } from './custom';
import { classicalPins, GATES } from './gates';
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

/** A classical wire from output `out` (default 0) of op `from` to a named input of op `to` (op indices). */
export interface Link {
  from: number;
  out?: number;
  to: number;
  pin: 'θ' | 'if' | 'cost';
}

export interface Example {
  name: string;
  description: string;
  qubits: number;
  init?: number[];
  /** Custom gates the example uses. */
  gates?: GateSpec[];
  ops: Op[];
  links?: Link[];
  /** Extra settings for some ops' blocks, by op index (e.g. a Hamiltonian's text). */
  setup?: Record<number, Partial<NodeData>>;
}

/** H₂ at 0.735 Å in a minimal basis, reduced to two qubits (electronic energy, in hartree). */
const H2 = '-1.0524 + 0.3979 Z0 - 0.3979 Z1 - 0.0113 Z0 Z1 + 0.1809 X0 X1';

/** QAOA (p = 1) for MaxCut on the 4-node ring 0–1–2–3–0. */
function qaoaRing(): Example {
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const ops: Op[] = [['Obs'], ['Opt'], ['H', 0], ['H', 1], ['H', 2], ['H', 3]];
  const links: Link[] = [{ from: 0, to: 1, pin: 'cost' }];
  // Cost layer: exp(−iγ Z_i Z_j) on every edge, as CNOT · Rz(γ) · CNOT.
  for (const [i, j] of edges) {
    ops.push(['CNOT', i, j], ['Rz', j], ['CNOT', i, j]);
    links.push({ from: 1, out: 0, to: ops.length - 2, pin: 'θ' });
  }
  // Mixer layer: Rx(β) on every qubit.
  for (let q = 0; q < 4; q++) {
    ops.push(['Rx', q]);
    links.push({ from: 1, out: 1, to: ops.length - 1, pin: 'θ' });
  }
  return {
    name: 'QAOA MaxCut',
    description: '4-node ring: Run the Optimizer to maximise the cut',
    qubits: 4,
    ops,
    links,
    setup: {
      0: { text: '2 - 0.5 Z0 Z1 - 0.5 Z1 Z2 - 0.5 Z2 Z3 - 0.5 Z3 Z0' },
      // From (0.2, 0.2) the climb stalls on the saddle at (0, 0); this start reaches the optimum.
      1: { vals: [-0.1, 0.1], goal: 'max', p: 0.05, steps: 300 },
    },
  };
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
    name: 'Teleportation',
    description: 'q0’s state arrives on q2, fixed up by the measured bits',
    qubits: 3,
    ops: [
      ['Ry', 0, 0.6], // 0: the state to send
      ['H', 1], ['CNOT', 1, 2], // 1–2: shared Bell pair
      ['CNOT', 0, 1], ['H', 0], // 3–4: Bell measurement…
      ['M', 0, 1], ['M', 1, 1], // 5–6: …collapsing q0 and q1
      ['X', 2], ['Z', 2], // 7–8: corrections, if the bits say so
      ['Probe', 2],
    ],
    links: [
      { from: 6, to: 7, pin: 'if' },
      { from: 5, to: 8, pin: 'if' },
    ],
  },
  {
    name: 'Shared angle',
    description: 'one Number drives three rotations',
    qubits: 3,
    ops: [['Num', 0.25], ['Ry', 0], ['Ry', 1], ['Ry', 2]],
    links: [
      { from: 0, to: 1, pin: 'θ' },
      { from: 0, to: 2, pin: 'θ' },
      { from: 0, to: 3, pin: 'θ' },
    ],
  },
  {
    name: 'VQE: H₂ molecule',
    description: 'Run the Optimizer to find the ground energy (−1.857 Ha)',
    qubits: 2,
    ops: [['Obs'], ['Opt'], ['Ry', 0], ['Ry', 1], ['CNOT', 0, 1]],
    links: [
      { from: 0, to: 1, pin: 'cost' },
      { from: 1, out: 0, to: 2, pin: 'θ' },
      { from: 1, out: 1, to: 3, pin: 'θ' },
    ],
    setup: {
      0: { text: H2 },
      1: { vals: [0.1, 0.1], goal: 'min', p: 0.05, steps: 200 },
    },
  },
  qaoaRing(),
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
    name: 'Grover search ×N',
    description: '3 qubits, marks |111⟩; try repeat ×1…×4 on the Grover step',
    qubits: 3,
    gates: [
      // CCZ from CNOTs and T gates (the Toffoli circuit without its Hadamards).
      {
        id: 'ex-ccz',
        name: 'CCZ',
        lanes: 3,
        ops: [
          ['CNOT', 1, 2], ['P', 2, -0.25], ['CNOT', 0, 2], ['T', 2], ['CNOT', 1, 2], ['P', 2, -0.25],
          ['CNOT', 0, 2], ['T', 1], ['T', 2], ['CNOT', 0, 1], ['T', 0], ['P', 1, -0.25], ['CNOT', 0, 1],
        ],
      },
      // Oracle (flip the sign of |111⟩), then diffusion (reflect about the mean).
      {
        id: 'ex-grover-step',
        name: 'Grover step',
        lanes: 3,
        ops: [
          ['@ex-ccz', 0, 1, 2],
          ['H', 0], ['H', 1], ['H', 2], ['X', 0], ['X', 1], ['X', 2],
          ['@ex-ccz', 0, 1, 2],
          ['X', 0], ['X', 1], ['X', 2], ['H', 0], ['H', 1], ['H', 2],
        ],
      },
    ],
    ops: [['H', 0], ['H', 1], ['H', 2], ['@ex-grover-step', 0, 1, 2], ['M', 0], ['M', 1], ['M', 2]],
    // Two steps is best for 8 items (94.5%); more overshoots.
    setup: { 3: { rep: 2 } },
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

/** A node of a generated circuit, with the qubit lane it is laid out on (−1 for classical blocks). */
export interface GraphNode extends SimNode, Partial<Pick<NodeData, 'def' | 'goal' | 'steps' | 'rep'>> {
  row: number;
}

/**
 * Turns an op list into a circuit graph (ids start at 1): one Qubit node per
 * qubit, then one node per op, each wired after the previous block on its
 * qubits, plus the classical `links`. Custom gates used by the ops must
 * already be registered.
 */
export function opsToGraph(
  qubits: number, ops: Op[], init: number[] = [], links: Link[] = [], setup: Example['setup'] = {},
): { nodes: GraphNode[]; wires: Wire[]; cwires: Wire[] } {
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
    const node: GraphNode = { id: ++id, type, p: param ?? (GATES[type].param ? 0.5 : 0), init: 0, row: qs[0] ?? -1 };
    if (custom) node.def = custom;
    nodes.push(node);
    qs.forEach((q, k) => {
      wires.push({ a: last[q][0], ai: last[q][1], b: id, bi: k });
      last[q] = [id, k];
    });
  }

  // Op i is node qubits + 1 + i.
  const opNode = (i: number) => nodes[qubits + i];
  for (const [i, extra] of Object.entries(setup)) Object.assign(opNode(Number(i)), extra);
  for (const l of links) if (l.pin === 'if') opNode(l.to).cond = true;
  const cwires = links.map((l) => ({
    a: opNode(l.from).id,
    ai: l.out ?? 0,
    b: opNode(l.to).id,
    bi: classicalPins(opNode(l.to)).ins.indexOf(l.pin),
  }));

  return { nodes, wires, cwires };
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
