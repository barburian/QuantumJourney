import { describe, expect, it } from 'vitest';
import { simulateCircuit } from '../src/custom';
import { EXAMPLES, opsToGraph, type Example } from '../src/examples';
import { expectation, parseHamiltonian, type Term } from '../src/hamiltonian';
import { minimise } from '../src/optimizer';
import type { NodeData } from '../src/types';

const terms = (text: string): Term[] => {
  const p = parseHamiltonian(text);
  if ('error' in p) throw new Error(p.error);
  return p.terms;
};

const R = Math.SQRT1_2;
const state = (amps: [number, number][]) => ({
  re: Float64Array.from(amps.map((a) => a[0])),
  im: Float64Array.from(amps.map((a) => a[1])),
});
const expect_ = (h: string, amps: [number, number][]) => {
  const { re, im } = state(amps);
  return expectation(terms(h), re, im);
};

describe('parseHamiltonian', () => {
  it('reads coefficients, signs, constants and products', () => {
    expect(terms('-1.05 + 0.4 Z0 - 0.18 X0 X1')).toEqual([
      { coef: -1.05, ops: [] },
      { coef: 0.4, ops: [{ pauli: 'Z', qubit: 0 }] },
      { coef: -0.18, ops: [{ pauli: 'X', qubit: 0 }, { pauli: 'X', qubit: 1 }] },
    ]);
    expect(terms('Z0Z1 + 2*Y3 − 1e-3 I0')).toEqual([
      { coef: 1, ops: [{ pauli: 'Z', qubit: 0 }, { pauli: 'Z', qubit: 1 }] },
      { coef: 2, ops: [{ pauli: 'Y', qubit: 3 }] },
      { coef: -1e-3, ops: [] },
    ]);
  });

  it.each(['', 'Z', 'Q0', 'Z0 Z0', '0.5 + * '])('rejects %j', (text) => {
    expect('error' in parseHamiltonian(text)).toBe(true);
  });
});

describe('expectation', () => {
  it('single-qubit Paulis', () => {
    expect(expect_('Z0', [[1, 0], [0, 0]])).toBeCloseTo(1);
    expect(expect_('Z0', [[0, 0], [1, 0]])).toBeCloseTo(-1);
    expect(expect_('X0', [[R, 0], [R, 0]])).toBeCloseTo(1);
    // |+i⟩ = (|0⟩ + i|1⟩)/√2 has ⟨Y⟩ = 1.
    expect(expect_('Y0', [[R, 0], [0, R]])).toBeCloseTo(1);
    expect(expect_('Y0', [[R, 0], [0, -R]])).toBeCloseTo(-1);
  });

  it('Bell state correlations and constants', () => {
    const bell: [number, number][] = [[R, 0], [0, 0], [0, 0], [R, 0]];
    expect(expect_('Z0 Z1', bell)).toBeCloseTo(1);
    expect(expect_('X0 X1', bell)).toBeCloseTo(1);
    expect(expect_('Y0 Y1', bell)).toBeCloseTo(-1);
    expect(expect_('Z0', bell)).toBeCloseTo(0);
    expect(expect_('3 - Z0 Z1', bell)).toBeCloseTo(2);
  });
});

/** The example's circuit, and its cost as a function of the Optimizer's parameters. */
function variational(ex: Example) {
  const g = opsToGraph(ex.qubits, ex.ops, ex.init, ex.links, ex.setup);
  const nodes: NodeData[] = g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row * 110 }));
  const opt = nodes.find((n) => n.type === 'Opt')!;
  const obs = nodes.find((n) => n.type === 'Obs')!;
  const run = (vals: number[]) => simulateCircuit(nodes.map((n) => (n === opt ? { ...n, vals } : n)), g.wires, g.cwires);
  const cost = (vals: number[]) => run(vals).classical.get(`${obs.id}:0`)![0];
  return { opt, cost, run };
}

describe('variational examples', () => {
  it('VQE finds the H₂ ground energy', () => {
    const ex = EXAMPLES.find((e) => e.name.startsWith('VQE'))!;
    const { opt, cost } = variational(ex);
    const best = minimise(cost, opt.vals!, { lr: 0.05, steps: 400 });
    expect(best.cost).toBeCloseTo(-1.8573, 3);
    // It actually went downhill from the start.
    expect(best.history[0]).toBeGreaterThan(best.cost + 0.5);
  });

  it('QAOA (p = 1) reaches the known ⟨cut⟩ = 3 on the 4-ring, most likely bitstrings being the max cuts', () => {
    const ex = EXAMPLES.find((e) => e.name.startsWith('QAOA'))!;
    const { opt, cost, run } = variational(ex);
    const best = minimise(cost, opt.vals!, { lr: 0.05, steps: 400, maximise: true });
    expect(best.cost).toBeCloseTo(3, 2);
    const p = run(best.x).probabilities!;
    const top = p.indexOf(Math.max(...p));
    expect([0b0101, 0b1010]).toContain(top);
  });

  it('an Expectation block naming a missing qubit has no value', () => {
    const ex = EXAMPLES.find((e) => e.name.startsWith('VQE'))!;
    const g = opsToGraph(ex.qubits, ex.ops, ex.init, ex.links, { ...ex.setup, 0: { text: 'Z5' } });
    const nodes: NodeData[] = g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row * 110 }));
    const obs = nodes.find((n) => n.type === 'Obs')!;
    expect(simulateCircuit(nodes, g.wires, g.cwires).classical.has(`${obs.id}:0`)).toBe(false);
  });
});
