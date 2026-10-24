/*
 * State-vector simulator. Collapsing measurements split the state into
 * weighted branches, so the final probabilities stay exact.
 *
 * Basis index bit q is the value of qubit q (q0 is the least significant bit).
 */
import { GATES, INITIAL_STATE_GATES } from './gates';
import type { GateType, NodeData, Wire } from './types';

export const MAX_QUBITS = 8;
/** Collapsing stops branching beyond this many branches (it then acts as a peek). */
const MAX_BRANCHES = 128;
const R = Math.SQRT1_2;

export type SimNode = Pick<NodeData, 'id' | 'type' | 'p' | 'init'>;

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
}

interface Branch {
  weight: number;
  re: Float64Array;
  im: Float64Array;
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

function applyGate(type: GateType, p: number, q: number[], re: Float64Array, im: Float64Array, n: number): void {
  const size = 1 << n;

  if (GATES[type].ins.length === 1) {
    const m = gateMatrix(type, p);
    const bit = 1 << q[0];
    for (let i = 0; i < size; i++) {
      if (i & bit) continue;
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

/** Splits every branch into its |0⟩ and |1⟩ outcomes for qubit q, renormalised. */
function collapse(branches: Branch[], q: number, size: number): Branch[] {
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
      next.push({ weight: b.weight * pr, re, im });
    }
  }
  return next;
}

/**
 * Runs the circuit. Every Qubit node is a wire source; a gate runs once all of
 * its inputs are wired to distinct qubits that have already reached it.
 * Unreachable gates are left out of `done`.
 */
export function simulate(nodes: readonly SimNode[], wires: readonly Wire[]): SimResult {
  const qubitNodes = nodes.filter((n) => n.type === 'Q');
  const n = qubitNodes.length;
  const done = new Set(qubitNodes.map((q) => q.id));
  const measurements = new Map<number, number>();
  const pins = new Map<string, QubitState>();
  const probes = new Map<number, ProbeReading>();
  if (!n || n > MAX_QUBITS) return { qubits: n, done, measurements, pins, probes };

  const size = 1 << n;
  let branches: Branch[] = [{ weight: 1, re: new Float64Array(size), im: new Float64Array(size) }];
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
      if (done.has(node.id)) continue;
      const inputs = GATES[node.type].ins.map((_, i) => {
        const w = wires.find((w) => w.b === node.id && w.bi === i);
        return w ? carried.get(`${w.a}:${w.ai}`) : undefined;
      });
      if (inputs.some((q) => q === undefined) || new Set(inputs).size < inputs.length) continue;
      const qs = inputs as number[];

      if (node.type === 'M') {
        const q = qs[0];
        let p1 = 0;
        for (const b of branches) p1 += b.weight * probabilityOfOne(b, q, size);
        measurements.set(node.id, p1);
        if (node.p && branches.length <= MAX_BRANCHES) branches = collapse(branches, q, size);
      } else if (node.type === 'Probe') {
        const single = branches.length === 1 ? branches[0] : null;
        probes.set(node.id, {
          ...qubitState(branches, qs[0], size),
          amplitudes: single ? Array.from(single.re, (re, i) => ({ re, im: single.im[i] })) : undefined,
          branches: branches.length,
        });
      } else {
        for (const b of branches) applyGate(node.type, node.p, qs, b.re, b.im, n);
      }

      qs.forEach((q, i) => {
        carried.set(`${node.id}:${i}`, q);
        pins.set(`${node.id}:${i}`, qubitState(branches, q, size));
      });
      done.add(node.id);
      progress = true;
    }
  }

  const probabilities = new Array<number>(size).fill(0);
  for (const b of branches) {
    for (let i = 0; i < size; i++) probabilities[i] += b.weight * (b.re[i] * b.re[i] + b.im[i] * b.im[i]);
  }
  return { qubits: n, done, measurements, pins, probes, probabilities, branches: branches.length };
}
