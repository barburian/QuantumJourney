/*
 * State-vector simulator. Collapsing measurements split the state into
 * weighted branches, so the final probabilities stay exact. Each branch
 * remembers its measured bits, so classical logic fed by measurements is
 * evaluated per branch.
 *
 * Basis index bit q is the value of qubit q (q0 is the least significant bit).
 */
import { classicalPins, GATES, INITIAL_STATE_GATES, mathOp } from './gates';
import { expectation, maxQubit, parseHamiltonian } from './hamiltonian';
import type { GateType, NodeData, Wire } from './types';

export const MAX_QUBITS = 8;
/** Collapsing stops branching beyond this many branches (it then acts as a peek). */
const MAX_BRANCHES = 128;
const R = Math.SQRT1_2;

/**
 * A block to simulate. Its first `arity` pins (by default the gate's own
 * input count) are targets; the next `controls` pins are control qubits: the
 * gate only acts where all of them are |1⟩. In and Out blocks pass their
 * qubits through unchanged. `sign` multiplies an angle that comes in on a
 * classical wire (−1 inside an inverted custom gate).
 */
export type SimNode = Pick<NodeData, 'id' | 'type' | 'p' | 'init' | 'cond' | 'op' | 'text' | 'vals'> & {
  arity?: number;
  controls?: number;
  sign?: number;
};

/** The state of one qubit at some point in the circuit. */
export interface QubitState {
  /** Index of the qubit. */
  qubit: number;
  /** Bloch vector [x, y, z]; shorter than 1 when the qubit is entangled or mixed. */
  bloch: [x: number, y: number, z: number];
  p1: number;
  /** True if the qubit is entangled with others (in any measurement branch). */
  entangled: boolean;
}

export interface ProbeReading extends QubitState {
  /** The full state vector at the probe; only when there is a single measurement branch. */
  amplitudes?: { re: number; im: number }[];
  branches: number;
}

export interface SimResult {
  /** Number of qubits in the circuit. */
  qubits: number;
  /** Ids of the nodes that were reached and applied. */
  done: Set<number>;
  /** P(1) for each measurement node that ran. */
  measurements: Map<number, number>;
  /** State of the qubit leaving each output pin that was reached, keyed "nodeId:outputIndex". */
  pins: Map<string, QubitState>;
  /** Reading of each probe node that was reached. */
  probes: Map<number, ProbeReading>;
  /** Final probability per basis state; absent when the circuit can't be simulated. */
  probabilities?: number[];
  /** Number of measurement branches at the end. */
  branches?: number;
  /** Final state vector; only when there is a single measurement branch. */
  state?: { re: Float64Array; im: Float64Array };
  /**
   * Distinct values of each classical output that can be computed, over all
   * branches, keyed "nodeId:outputIndex".
   */
  classical: Map<string, number[]>;
  /** The angle used by each rotation whose θ comes from a classical wire; NaN if it differs per branch. */
  angles: Map<number, number>;
}

interface Branch {
  weight: number;
  re: Float64Array;
  im: Float64Array;
  /** Measured bits, by measurement node id. */
  bits: Map<number, number>;
}

/** 2x2 complex matrix as [m00, m01, m10, m11], each entry [re, im]. */
type Matrix = [number, number][];

function gateMatrix(type: GateType, p: number): Matrix {
  const h = (p || 0) * Math.PI;
  const c = Math.cos(h / 2);
  const s = Math.sin(h / 2);
  switch (type) {
    case 'H': return [[R, 0], [R, 0], [R, 0], [-R, 0]];
    case 'X': return [[0, 0], [1, 0], [1, 0], [0, 0]];
    case 'Y': return [[0, 0], [0, -1], [0, 1], [0, 0]];
    case 'Z': return [[1, 0], [0, 0], [0, 0], [-1, 0]];
    case 'S': return [[1, 0], [0, 0], [0, 0], [0, 1]];
    case 'T': return [[1, 0], [0, 0], [0, 0], [R, R]];
    case 'Rx': return [[c, 0], [0, -s], [0, -s], [c, 0]];
    case 'Ry': return [[c, 0], [-s, 0], [s, 0], [c, 0]];
    case 'Rz': return [[c, -s], [0, 0], [0, 0], [c, s]];
    case 'P': return [[1, 0], [0, 0], [0, 0], [Math.cos(h), Math.sin(h)]];
    default: throw new Error(`${type} is not a single-qubit gate`);
  }
}

/** Applies a gate to qubits `q`, only on basis states where every bit of `controls` is set. */
function applyGate(
  type: GateType, p: number, q: number[], re: Float64Array, im: Float64Array, n: number, controls = 0,
): void {
  const size = 1 << n;

  if (GATES[type].ins.length === 1) {
    const m = gateMatrix(type, p);
    const bit = 1 << q[0];
    for (let i = 0; i < size; i++) {
      if (i & bit || (i & controls) !== controls) continue;
      const j = i | bit;
      const ar = re[i], ai = im[i], br = re[j], bi = im[j];
      re[i] = m[0][0] * ar - m[0][1] * ai + m[1][0] * br - m[1][1] * bi;
      im[i] = m[0][0] * ai + m[0][1] * ar + m[1][0] * bi + m[1][1] * br;
      re[j] = m[2][0] * ar - m[2][1] * ai + m[3][0] * br - m[3][1] * bi;
      im[j] = m[2][0] * ai + m[2][1] * ar + m[3][0] * bi + m[3][1] * br;
    }
    return;
  }

  const a = 1 << q[0];
  const b = 1 << q[1];
  for (let i = 0; i < size; i++) {
    if ((i & controls) !== controls) continue;
    if (type === 'CNOT' && i & a && !(i & b)) {
      const j = i | b;
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    } else if (type === 'CZ' && i & a && i & b) {
      re[i] = -re[i];
      im[i] = -im[i];
    } else if (type === 'CP' && i & a && i & b) {
      const h = (p || 0) * Math.PI, c = Math.cos(h), s = Math.sin(h);
      const r = re[i], m = im[i];
      re[i] = r * c - m * s;
      im[i] = r * s + m * c;
    } else if (type === 'SWAP' && i & a && !(i & b)) {
      const j = i ^ a ^ b;
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
}

function probabilityOfOne(b: Branch, q: number, size: number): number {
  let sum = 0;
  for (let i = 0; i < size; i++) if ((i >> q) & 1) sum += b.re[i] * b.re[i] + b.im[i] * b.im[i];
  return sum;
}

/** Reduced state of qubit q, averaged over the measurement branches. */
function qubitState(branches: Branch[], q: number, size: number): QubitState {
  const bit = 1 << q;
  let x = 0, y = 0, z = 0, entangled = false;
  for (const b of branches) {
    // Single-qubit density matrix of this branch: ρ00, ρ11 and ρ01 = Σ a_i·conj(a_j).
    let r00 = 0, r11 = 0, cRe = 0, cIm = 0;
    for (let i = 0; i < size; i++) {
      if (i & bit) continue;
      const j = i | bit;
      const ar = b.re[i], ai = b.im[i], br = b.re[j], bi = b.im[j];
      r00 += ar * ar + ai * ai;
      r11 += br * br + bi * bi;
      cRe += ar * br + ai * bi;
      cIm += ai * br - ar * bi;
    }
    const bx = 2 * cRe, by = -2 * cIm, bz = r00 - r11;
    // A pure global state whose reduced state is mixed is entangled.
    if (b.weight > 1e-9 && Math.hypot(bx, by, bz) < 1 - 1e-6) entangled = true;
    x += b.weight * bx;
    y += b.weight * by;
    z += b.weight * bz;
  }
  return { qubit: q, bloch: [x, y, z], p1: (1 - z) / 2, entangled };
}

/**
 * Splits every branch into its |0⟩ and |1⟩ outcomes for qubit q,
 * renormalised, recording the outcome as the bit of measurement `id`.
 */
function collapse(branches: Branch[], q: number, size: number, id: number): Branch[] {
  const next: Branch[] = [];
  for (const b of branches) {
    const p1 = probabilityOfOne(b, q, size);
    for (const outcome of [0, 1]) {
      const pr = outcome ? p1 : 1 - p1;
      if (pr < 1e-12) continue;
      const re = new Float64Array(size), im = new Float64Array(size), scale = 1 / Math.sqrt(pr);
      for (let i = 0; i < size; i++) {
        if (((i >> q) & 1) === outcome) {
          re[i] = b.re[i] * scale;
          im[i] = b.im[i] * scale;
        }
      }
      next.push({ weight: b.weight * pr, re, im, bits: new Map(b.bits).set(id, outcome) });
    }
  }
  return next;
}

/**
 * Runs the circuit. Every Qubit node is a wire source; a gate runs once all of
 * its inputs are wired to distinct qubits that have already reached it, and
 * every classical value it reads (`cwires`) can be computed. Unreachable gates
 * are left out of `done`.
 */
export function simulate(nodes: readonly SimNode[], wires: readonly Wire[], cwires: readonly Wire[] = []): SimResult {
  const qubitNodes = nodes.filter((n) => n.type === 'Q');
  const n = qubitNodes.length;
  const done = new Set(qubitNodes.map((q) => q.id));
  const measurements = new Map<number, number>();
  const pins = new Map<string, QubitState>();
  const probes = new Map<number, ProbeReading>();
  const classical = new Map<string, number[]>();
  const angles = new Map<number, number>();
  const empty = { qubits: n, done, measurements, pins, probes, classical, angles };
  if (n > MAX_QUBITS) return empty;

  /* ----- classical values ----- */
  const byId = new Map(nodes.map((node) => [node.id, node]));
  /** Measurements that collapsed, so their bit exists in every branch. */
  const collapsed = new Set<number>();
  const feed = (id: number, pin: number) => cwires.find((w) => w.b === id && w.bi === pin);
  /** Set once every gate has run: expectation values read the final state. */
  let finished = false;
  /** True once a classical output can be computed. */
  const ready = (id: number): boolean => {
    const node = byId.get(id);
    switch (node?.type) {
      case 'Num': case 'Opt': return true;
      case 'M': return collapsed.has(id);
      case 'Obs': {
        const parsed = parseHamiltonian(node.text ?? '');
        return finished && n > 0 && 'terms' in parsed && maxQubit(parsed.terms) < n;
      }
      case 'Math':
        return classicalPins(node).ins.every((_, i) => {
          const w = feed(id, i);
          return !!w && ready(w.a);
        });
      default: return false;
    }
  };
  /** A classical output's value in one branch. Only call once `ready`. */
  const value = (id: number, branch: Branch, out = 0): number => {
    const node = byId.get(id)!;
    switch (node.type) {
      case 'Num': return node.p;
      case 'Opt': return node.vals?.[out] ?? 0;
      case 'M': return branch.bits.get(id) ?? 0;
      case 'Obs': return observe(node);
      default: {
        const [a, b] = classicalPins(node).ins.map((_, i) => {
          const w = feed(id, i)!;
          return value(w.a, branch, w.ai);
        });
        return mathOp(node.op, a, b ?? 0);
      }
    }
  };
  /** ⟨H⟩ over the final state, averaged over the measurement branches (the same in every branch). */
  const observed = new Map<number, number>();
  const observe = (node: SimNode): number => {
    if (!observed.has(node.id)) {
      const parsed = parseHamiltonian(node.text ?? '');
      const terms = 'terms' in parsed ? parsed.terms : [];
      observed.set(node.id, branches.reduce((s, b) => s + b.weight * expectation(terms, b.re, b.im), 0));
    }
    return observed.get(node.id)!;
  };

  const size = 1 << n;
  let branches: Branch[] = [{ weight: 1, re: new Float64Array(size), im: new Float64Array(size), bits: new Map() }];
  branches[0].re[0] = 1;

  // Which qubit leaves each output pin, keyed "nodeId:outputIndex".
  const carried = new Map<string, number>();
  qubitNodes.forEach((q, i) => {
    carried.set(`${q.id}:0`, i);
    for (const t of INITIAL_STATE_GATES[q.init || 0]) applyGate(t, 0, [i], branches[0].re, branches[0].im, n);
  });
  qubitNodes.forEach((q, i) => pins.set(`${q.id}:0`, qubitState(branches, i, size)));

  let progress = true;
  while (progress) {
    progress = false;
    for (const node of nodes) {
      if (done.has(node.id) || GATES[node.type].kind === 'cl') continue;
      const cins = classicalPins(node).ins;
      const fed = cins.map((_, i) => feed(node.id, i));
      if (fed.some((w) => w && !ready(w.a))) continue;
      const arity = node.arity ?? GATES[node.type].ins.length;
      const inputs = Array.from({ length: arity + (node.controls ?? 0) }, (_, i) => {
        const w = wires.find((w) => w.b === node.id && w.bi === i);
        return w ? carried.get(`${w.a}:${w.ai}`) : undefined;
      });
      if (inputs.some((q) => q === undefined) || new Set(inputs).size < inputs.length) continue;
      const qs = inputs as number[];
      const targets = qs.slice(0, arity);
      const controlMask = qs.slice(arity).reduce((mask, q) => mask | (1 << q), 0);

      if (node.type === 'In' || node.type === 'Out') {
        // Boundary of a custom gate: nothing to apply.
      } else if (node.type === 'M') {
        // Measurements ignore controls; controlled custom gates can't contain them.
        const q = targets[0];
        let p1 = 0;
        for (const b of branches) p1 += b.weight * probabilityOfOne(b, q, size);
        measurements.set(node.id, p1);
        if (node.p && branches.length <= MAX_BRANCHES) {
          branches = collapse(branches, q, size, node.id);
          collapsed.add(node.id);
        }
      } else if (node.type === 'Probe') {
        const single = branches.length === 1 ? branches[0] : null;
        probes.set(node.id, {
          ...qubitState(branches, targets[0], size),
          amplitudes: single ? Array.from(single.re, (re, i) => ({ re, im: single.im[i] })) : undefined,
          branches: branches.length,
        });
      } else {
        const theta = fed[cins.indexOf('θ')];
        const condition = fed[cins.indexOf('if')];
        const used = new Set<number>();
        for (const b of branches) {
          // A conditional gate only acts in branches where its condition is non-zero.
          if (condition && !value(condition.a, b, condition.ai)) continue;
          const p = theta ? value(theta.a, b, theta.ai) * (node.sign ?? 1) : node.p;
          used.add(p);
          applyGate(node.type, p, targets, b.re, b.im, n, controlMask);
        }
        if (theta) angles.set(node.id, used.size === 1 ? [...used][0] : NaN);
      }

      qs.forEach((q, i) => {
        carried.set(`${node.id}:${i}`, q);
        pins.set(`${node.id}:${i}`, qubitState(branches, q, size));
      });
      done.add(node.id);
      progress = true;
    }
  }

  finished = true;
  for (const node of nodes) {
    const outs = classicalPins(node).outs;
    if (!outs.length || !ready(node.id)) continue;
    if (node.type !== 'M') done.add(node.id);
    outs.forEach((_, out) => {
      const values = new Set(branches.map((b) => Math.round(value(node.id, b, out) * 1e9) / 1e9));
      classical.set(`${node.id}:${out}`, [...values].sort((a, b) => a - b));
    });
  }

  if (!n) return empty;
  const probabilities = new Array<number>(size).fill(0);
  for (const b of branches) {
    for (let i = 0; i < size; i++) probabilities[i] += b.weight * (b.re[i] * b.re[i] + b.im[i] * b.im[i]);
  }
  const state = branches.length === 1 ? { re: branches[0].re, im: branches[0].im } : undefined;
  return { ...empty, probabilities, branches: branches.length, state };
}
