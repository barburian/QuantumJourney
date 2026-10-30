import { beforeEach, describe, expect, it } from 'vitest';
import { defs, groupNodes, measures, pinLabels, simulateCircuit, uses, type CustomDef } from '../src/custom';
import { EXAMPLES, opsToGraph, registerExampleGates, type Op } from '../src/examples';
import type { NodeData, Wire } from '../src/types';

/** An op list as editor data: qubits in a column, gates left to right. */
function circuit(qubits: number, ops: Op[], init?: number[]): { nodes: NodeData[]; wires: Wire[] } {
  const g = opsToGraph(qubits, ops, init);
  let x = 0;
  const nodes = g.nodes.map(({ row, ...n }) => ({ ...n, x: n.type === 'Q' ? 0 : (x += 100), y: row * 110 }));
  return { nodes, wires: g.wires };
}

/** Groups every non-qubit block of an op list into a definition and registers it. */
function define(name: string, qubits: number, ops: Op[]): CustomDef {
  const c = circuit(qubits, ops);
  const g = groupNodes(c.nodes, c.wires, name)!;
  defs.set(g.def.id, g.def);
  return g.def;
}

/**
 * A circuit of qubits feeding a chain of Custom blocks, each acting on the
 * listed qubit lanes; a controlled block takes its control qubit last.
 */
function withGates(
  qubits: number,
  init: number[],
  blocks: { def: CustomDef; on: number[]; dagger?: boolean; ctrl?: boolean }[],
): { nodes: NodeData[]; wires: Wire[] } {
  const nodes: NodeData[] = [];
  const wires: Wire[] = [];
  const last: [number, number][] = [];
  let id = 0;
  for (let q = 0; q < qubits; q++) {
    nodes.push({ id: ++id, type: 'Q', x: 0, y: q * 110, p: 0, init: init[q] || 0 });
    last[q] = [id, 0];
  }
  for (const b of blocks) {
    nodes.push({ id: ++id, type: 'Custom', x: id * 100, y: 0, p: 0, init: 0, def: b.def.id, dagger: b.dagger, ctrl: b.ctrl });
    b.on.forEach((q, pin) => {
      wires.push({ a: last[q][0], ai: last[q][1], b: id, bi: pin });
      last[q] = [id, pin];
    });
  }
  return { nodes, wires };
}

const probabilities = (c: { nodes: NodeData[]; wires: Wire[] }) =>
  simulateCircuit(c.nodes, c.wires).probabilities?.map((v) => Math.round(v * 1e9) / 1e9);

beforeEach(() => defs.clear());

describe('grouping', () => {
  it('turns a selection into a definition with one lane per qubit', () => {
    const c = circuit(2, [['H', 0], ['CNOT', 0, 1]]);
    const g = groupNodes(c.nodes, c.wires, 'Bell')!;
    expect(g.def.lanes).toBe(2);
    expect(g.def.nodes.filter((n) => n.type === 'In' || n.type === 'Out')).toHaveLength(2);
    expect(g.def.nodes.some((n) => n.type === 'Q')).toBe(false);
    // Only plain data is kept, so definitions can be saved.
    const withExtras = c.nodes.map((n) => ({ ...n, el: {} }));
    expect(() => structuredClone(groupNodes(withExtras, c.wires, 'Bell')!.def)).not.toThrow();
    expect(groupNodes(withExtras, c.wires, 'Bell')!.def.nodes.some((n) => 'el' in n)).toBe(false);
    // Lane 0 comes from qubit 1's output, lane 1 from qubit 2's.
    expect(g.sources).toEqual([[1, 0], [2, 0]]);
    expect(g.targets).toEqual([null, null]);
  });

  it('orders lanes by the height of their first pin', () => {
    // Node ids: 1, 2 = qubits, 3 = CNOT acting with target on top.
    const c = circuit(2, [['CNOT', 1, 0]]);
    const pinY = (_: NodeData, pin: number) => (pin === 0 ? 200 : 100);
    const g = groupNodes(c.nodes, c.wires, 'Flipped', pinY)!;
    expect(g.sources).toEqual([[1, 0], [2, 0]]);
  });

  it('keeps the outside connections of a partial selection', () => {
    // Node ids: 1 = qubit, 2 = H, 3 = X, 4 = Z. Group only the X.
    const c = circuit(1, [['H', 0], ['X', 0], ['Z', 0]]);
    const g = groupNodes([c.nodes[2]], c.wires, 'X')!;
    expect(g.def.lanes).toBe(1);
    expect(g.sources).toEqual([[2, 0]]);
    expect(g.targets).toEqual([[4, 0]]);
  });

  it('a grouped circuit simulates exactly like the original', () => {
    const ops: Op[] = [['H', 0], ['CNOT', 0, 1], ['Ry', 1, 0.3], ['CP', 1, 0, 0.25], ['H', 1]];
    const def = define('U', 2, ops);
    expect(probabilities(withGates(2, [], [{ def, on: [0, 1] }]))).toEqual(probabilities(circuit(2, ops)));
  });

  it('reports pin states and progress for Custom blocks', () => {
    const def = define('Bell', 2, [['H', 0], ['CNOT', 0, 1]]);
    const c = withGates(2, [], [{ def, on: [0, 1] }]);
    const r = simulateCircuit(c.nodes, c.wires);
    expect(r.done.has(3)).toBe(true);
    expect(r.pins.get('3:0')?.entangled).toBe(true);
    expect(r.pins.get('3:1')?.entangled).toBe(true);
  });
});

describe('inverse (dagger)', () => {
  it('U followed by U† is the identity', () => {
    const def = define('U', 2, [['H', 0], ['S', 0], ['CNOT', 0, 1], ['T', 1], ['Rx', 1, 0.3], ['CP', 0, 1, 0.7]]);
    const c = withGates(2, [], [{ def, on: [0, 1] }, { def, on: [0, 1], dagger: true }]);
    expect(probabilities(c)).toEqual([1, 0, 0, 0]);
  });

  it('S† undoes S and T† undoes T', () => {
    // H S S† H = I and H T T† H = I, whereas H S S H = X.
    const s = define('S', 1, [['S', 0]]);
    const t = define('T', 1, [['T', 0]]);
    const h = define('H', 1, [['H', 0]]);
    expect(probabilities(withGates(1, [], [
      { def: h, on: [0] }, { def: s, on: [0] }, { def: s, on: [0], dagger: true },
      { def: t, on: [0] }, { def: t, on: [0], dagger: true }, { def: h, on: [0] },
    ]))).toEqual([1, 0]);
  });
});

describe('controlled', () => {
  const flip = () => define('Flip', 1, [['X', 0]]);

  it('acts only when the control is |1⟩', () => {
    const def = flip();
    // Qubit 0 is the target, qubit 1 the control.
    expect(probabilities(withGates(2, [0, 0], [{ def, on: [0, 1], ctrl: true }]))).toEqual([1, 0, 0, 0]);
    expect(probabilities(withGates(2, [0, 1], [{ def, on: [0, 1], ctrl: true }]))).toEqual([0, 0, 0, 1]);
  });

  it('a controlled CNOT is a Toffoli', () => {
    const def = define('CNOT', 2, [['CNOT', 0, 1]]);
    const toffoli = (init: number[]) => probabilities(withGates(3, init, [{ def, on: [0, 1, 2], ctrl: true }]));
    // |q2 q1 q0⟩: flips q1 only when q0 and q2 are both 1.
    expect(toffoli([1, 0, 1])!.indexOf(1)).toBe(0b111);
    expect(toffoli([1, 0, 0])!.indexOf(1)).toBe(0b001);
    expect(toffoli([0, 0, 1])!.indexOf(1)).toBe(0b100);
  });

  it('a superposed control entangles', () => {
    const def = flip();
    // |+⟩ control on qubit 1 makes a Bell state.
    expect(probabilities(withGates(2, [0, 2], [{ def, on: [0, 1], ctrl: true }]))).toEqual([0.5, 0, 0, 0.5]);
  });

  it('controlled and inverted together', () => {
    const def = define('R', 1, [['Ry', 0, 0.4], ['T', 0]]);
    const c = withGates(2, [0, 1], [{ def, on: [0, 1], ctrl: true }, { def, on: [0, 1], ctrl: true, dagger: true }]);
    expect(probabilities(c)).toEqual([0, 0, 1, 0]);
  });
});

describe('nesting', () => {
  it('runs custom gates inside custom gates, controlled from outside', () => {
    const inner = define('Flip', 1, [['X', 0]]);
    // outer = Flip on its single lane, built from an instance of inner.
    const c = withGates(1, [], [{ def: inner, on: [0] }]);
    const g = groupNodes(c.nodes, c.wires, 'Outer')!;
    defs.set(g.def.id, g.def);
    expect(uses(g.def.id, inner.id)).toBe(true);
    expect(uses(inner.id, g.def.id)).toBe(false);
    expect(probabilities(withGates(2, [0, 1], [{ def: g.def, on: [0, 1], ctrl: true }]))).toEqual([0, 0, 0, 1]);
    expect(probabilities(withGates(2, [0, 0], [{ def: g.def, on: [0, 1], ctrl: true }]))).toEqual([1, 0, 0, 0]);
  });

  it('knows which gates measure', () => {
    expect(measures(define('M', 1, [['M', 0]]).id)).toBe(true);
    expect(measures(define('H', 1, [['H', 0]]).id)).toBe(false);
  });
});

describe('examples with custom gates', () => {
  const runExample = (name: string) => {
    const ex = EXAMPLES.find((e) => e.name === name)!;
    registerExampleGates(ex);
    const g = opsToGraph(ex.qubits, ex.ops, ex.init);
    const nodes = g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row * 110 }));
    return simulateCircuit(nodes, g.wires);
  };
  const certain = (r: ReturnType<typeof simulateCircuit>) => r.probabilities!.findIndex((v) => v > 1 - 1e-9);

  it('Deutsch: a balanced oracle gives x = 1', () => {
    // |q1 q0⟩: x = 1 (balanced), ancilla back to |1⟩.
    expect(certain(runExample('Deutsch'))).toBe(0b11);
  });

  it('Deutsch–Jozsa: the parity oracle gives a non-zero input register', () => {
    expect(certain(runExample('Deutsch–Jozsa'))).toBe(0b1111);
  });

  it('a constant oracle gives all zeros', () => {
    const ex = EXAMPLES.find((e) => e.name === 'Deutsch–Jozsa')!;
    registerExampleGates(ex);
    // Make f constant: the oracle leaves the ancilla alone.
    const oracle = defs.get('ex-dj-oracle')!;
    const cnots = new Set(oracle.nodes.filter((n) => n.type === 'CNOT').map((n) => n.id));
    oracle.nodes = oracle.nodes.filter((n) => !cnots.has(n.id));
    const inId = oracle.nodes.find((n) => n.type === 'In')!.id, outId = oracle.nodes.find((n) => n.type === 'Out')!.id;
    oracle.wires = [0, 1, 2, 3].map((k) => ({ a: inId, ai: k, b: outId, bi: k }));
    const g = opsToGraph(ex.qubits, ex.ops, ex.init);
    const r = simulateCircuit(g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row * 110 })), g.wires);
    // Inputs all 0, ancilla 1.
    expect(certain(r)).toBe(0b1000);
  });
});

describe('editing a definition', () => {
  it('pins follow the definition', () => {
    const def = define('Bell', 2, [['H', 0], ['CNOT', 0, 1]]);
    expect(pinLabels({ type: 'Custom', def: def.id }).ins).toHaveLength(2);
    expect(pinLabels({ type: 'Custom', def: def.id, ctrl: true }).ins).toHaveLength(3);
    expect(pinLabels({ type: 'In', def: def.id })).toEqual({ ins: [], outs: ['lane 0', 'lane 1'] });
  });

  it('simulates the inside view with its inputs starting in |0⟩', () => {
    const def = define('Bell', 2, [['H', 0], ['CNOT', 0, 1]]);
    expect(probabilities(def)).toEqual([0.5, 0, 0, 0.5]);
  });
});
