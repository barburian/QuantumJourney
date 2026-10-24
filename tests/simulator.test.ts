import { describe, expect, it } from 'vitest';
import { EXAMPLES, opsToGraph, type Op } from '../src/examples';
import { simulate } from '../src/simulator';

const run = (qubits: number, ops: Op[], init?: number[]) => {
  const { nodes, wires } = opsToGraph(qubits, ops, init);
  return simulate(nodes, wires);
};

const runExample = (name: string) => {
  const ex = EXAMPLES.find((e) => e.name === name);
  if (!ex) throw new Error(`No example named ${name}`);
  return run(ex.qubits, ex.ops, ex.init);
};

/** Probabilities rounded so they can be compared exactly. */
const rounded = (p: number[] | undefined) => p?.map((v) => Math.round(v * 1e9) / 1e9);

describe('simulate', () => {
  it('reports an empty circuit', () => {
    const r = simulate([], []);
    expect(r.qubits).toBe(0);
    expect(r.probabilities).toBeUndefined();
  });

  it('starts every qubit in |0⟩', () => {
    expect(rounded(run(2, []).probabilities)).toEqual([1, 0, 0, 0]);
  });

  it('prepares the selected initial states', () => {
    expect(rounded(run(1, [], [1]).probabilities)).toEqual([0, 1]);
    expect(rounded(run(1, [], [2]).probabilities)).toEqual([0.5, 0.5]);
    // |−⟩ followed by H is |1⟩.
    expect(rounded(run(1, [['H', 0]], [3]).probabilities)).toEqual([0, 1]);
  });

  it('refuses more than 8 qubits', () => {
    const r = run(9, []);
    expect(r.qubits).toBe(9);
    expect(r.probabilities).toBeUndefined();
  });

  it('skips gates that are not fully wired', () => {
    const { nodes, wires } = opsToGraph(2, [['CNOT', 0, 1]]);
    const cnot = nodes[2];
    const r = simulate(nodes, wires.filter((w) => !(w.b === cnot.id && w.bi === 1)));
    expect(r.done.has(cnot.id)).toBe(false);
  });

  it('rotations take their angle in multiples of π', () => {
    expect(rounded(run(1, [['Rx', 0, 1]]).probabilities)).toEqual([0, 1]);
    expect(rounded(run(1, [['Ry', 0, 0.5]]).probabilities)).toEqual([0.5, 0.5]);
  });

  it('applies phase gates without changing probabilities until interference', () => {
    // H Z H = X
    expect(rounded(run(1, [['H', 0], ['Z', 0], ['H', 0]]).probabilities)).toEqual([0, 1]);
    // H S S H = X
    expect(rounded(run(1, [['H', 0], ['S', 0], ['S', 0], ['H', 0]]).probabilities)).toEqual([0, 1]);
  });

  it('swaps qubits', () => {
    expect(rounded(run(2, [['X', 0], ['SWAP', 0, 1]]).probabilities)).toEqual([0, 0, 1, 0]);
  });
});

const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0; // + 0 turns -0 into 0
const blochOf = (r: ReturnType<typeof run>, pin: string) => r.pins.get(pin)?.bloch.map(round);

describe('qubit states', () => {
  it('reports the Bloch vector leaving every pin', () => {
    // Node ids: 1 = qubit, 2 = H, 3 = S.
    const r = run(1, [['H', 0], ['S', 0]]);
    expect(blochOf(r, '1:0')).toEqual([0, 0, 1]);
    expect(blochOf(r, '2:0')).toEqual([1, 0, 0]);
    expect(blochOf(r, '3:0')).toEqual([0, 1, 0]);
    expect(round(r.pins.get('2:0')!.p1)).toBe(0.5);
  });

  it('|−⟩ points along −x', () => {
    expect(blochOf(run(1, [], [3]), '1:0')).toEqual([-1, 0, 0]);
  });

  it('flags entanglement after a CNOT but not before', () => {
    // Node ids: 1, 2 = qubits, 3 = H, 4 = CNOT.
    const r = run(2, [['H', 0], ['CNOT', 0, 1]]);
    expect(r.pins.get('3:0')!.entangled).toBe(false);
    expect(r.pins.get('4:0')!.entangled).toBe(true);
    expect(r.pins.get('4:1')!.entangled).toBe(true);
    expect(blochOf(r, '4:0')).toEqual([0, 0, 0]);
  });

  it('product states of several qubits are not entangled', () => {
    const r = runExample('Uniform superposition');
    for (const s of r.pins.values()) expect(s.entangled).toBe(false);
  });

  it('a collapsed qubit is mixed but not entangled', () => {
    // Node ids: 1 = qubit, 2 = H, 3 = M (collapse).
    const r = run(1, [['H', 0], ['M', 0, 1]]);
    expect(r.pins.get('3:0')!.entangled).toBe(false);
    expect(blochOf(r, '3:0')).toEqual([0, 0, 0]);
  });
});

describe('probes', () => {
  it('pass the state through unchanged', () => {
    const plain = run(2, [['H', 0], ['CNOT', 0, 1]]);
    const probed = run(2, [['H', 0], ['Probe', 0], ['CNOT', 0, 1]]);
    expect(rounded(probed.probabilities)).toEqual(rounded(plain.probabilities));
  });

  it('read the qubit and the full state vector', () => {
    // Node ids: 1, 2 = qubits, 3 = X, 4 = H, 5 = Probe.
    const r = run(2, [['X', 1], ['H', 0], ['Probe', 0]]);
    const probe = r.probes.get(5)!;
    expect(probe.qubit).toBe(0);
    expect(probe.bloch.map(round)).toEqual([1, 0, 0]);
    expect(probe.amplitudes!.map(({ re, im }) => [round(re), round(im)])).toEqual([
      [0, 0], [0, 0], [round(Math.SQRT1_2), 0], [round(Math.SQRT1_2), 0],
    ]);
  });

  it('give no state vector after a collapse', () => {
    // Node ids: 1 = qubit, 2 = H, 3 = M (collapse), 4 = Probe.
    const probe = run(1, [['H', 0], ['M', 0, 1], ['Probe', 0]]).probes.get(4)!;
    expect(probe.branches).toBe(2);
    expect(probe.amplitudes).toBeUndefined();
  });
});

describe('examples', () => {
  it('Bell state', () => {
    expect(rounded(runExample('Bell state').probabilities)).toEqual([0.5, 0, 0, 0.5]);
  });

  it('GHZ state', () => {
    expect(rounded(runExample('GHZ state').probabilities)).toEqual([0.5, 0, 0, 0, 0, 0, 0, 0.5]);
  });

  it('Uniform superposition', () => {
    expect(rounded(runExample('Uniform superposition').probabilities)).toEqual(new Array(8).fill(0.125));
  });

  it('Grover search finds |11⟩', () => {
    const r = runExample('Grover search');
    expect(rounded(r.probabilities)).toEqual([0, 0, 0, 1]);
    expect([...r.measurements.values()].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 1]);
  });

  it('Quantum Fourier transform spreads a basis state evenly', () => {
    const r = runExample('Quantum Fourier transform');
    expect(r.done.size).toBe(3 + 7);
    expect(rounded(r.probabilities)).toEqual(new Array(8).fill(0.125));
  });

  it('Mid-circuit measurement collapses into two branches', () => {
    const r = runExample('Mid-circuit measurement');
    expect(r.branches).toBe(2);
    expect(rounded(r.probabilities)).toEqual([0.5, 0.5]);
  });

  it('a peek measurement does not disturb the state', () => {
    const r = run(1, [['H', 0], ['M', 0, 0], ['H', 0]]);
    expect(r.branches).toBe(1);
    expect(rounded(r.probabilities)).toEqual([1, 0]);
    expect(Math.round(r.measurements.values().next().value! * 1e9) / 1e9).toBe(0.5);
  });
});
