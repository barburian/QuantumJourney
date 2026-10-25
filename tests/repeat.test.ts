import { beforeEach, describe, expect, it } from 'vitest';
import { defs, groupNodes, nodeData, nodeTitle, repeats, simulateCircuit, type CustomDef } from '../src/custom';
import { EXAMPLES, opsToGraph, registerExampleGates, type Op } from '../src/examples';
import { blockMatrix } from '../src/matrix';
import type { NodeData, Wire } from '../src/types';

/** Groups an op list's gates into a definition and registers it. */
function define(name: string, qubits: number, ops: Op[]): CustomDef {
  const g = opsToGraph(qubits, ops);
  let x = 0;
  const nodes = g.nodes.map(({ row, ...n }) => ({ ...n, x: n.type === 'Q' ? 0 : (x += 100), y: row * 110 }));
  const { def } = groupNodes(nodes, g.wires, name)!;
  defs.set(def.id, def);
  return def;
}

/** Qubits (with initial states) feeding one Custom block on all its lanes. */
function run(def: CustomDef, init: number[], block: Partial<NodeData> = {}): number[] {
  const nodes: NodeData[] = init.map((s, q) => ({ id: q + 1, type: 'Q', x: 0, y: q * 110, p: 0, init: s }));
  const id = init.length + 1;
  nodes.push({ id, type: 'Custom', x: 100, y: 0, p: 0, init: 0, def: def.id, ...block });
  const wires: Wire[] = init.map((_, q) => ({ a: q + 1, ai: 0, b: id, bi: q }));
  return simulateCircuit(nodes, wires).probabilities!.map((v) => Math.round(v * 1e6) / 1e6);
}

const diagonal = (m: { re: number; im: number }[][]) =>
  m.map((row, r) => Math.round(row[r].re * 1e6) / 1e6 + 0);

beforeEach(() => defs.clear());

describe('repeat ×N', () => {
  it('runs a gate N times in a row', () => {
    const quarter = define('Rx/4', 1, [['Rx', 0, 0.25]]);
    expect(run(quarter, [0])).toEqual([0.853553, 0.146447]);
    expect(run(quarter, [0], { rep: 4 })).toEqual([0, 1]); // Rx(π/4)⁴ = Rx(π)
    expect(run(quarter, [0], { rep: 8 })).toEqual([1, 0]);
  });

  it('repeats the inverse when the gate is inverted', () => {
    const t = define('T', 1, [['T', 0]]);
    expect(diagonal(blockMatrix({ type: 'Custom', p: 0, def: t.id, rep: 4 })!)).toEqual([1, -1]); // T⁴ = Z
    const m = blockMatrix({ type: 'Custom', p: 0, def: t.id, rep: 2, dagger: true })!; // (T†)² = S†
    expect(m[1][1].re).toBeCloseTo(0);
    expect(m[1][1].im).toBeCloseTo(-1);
  });

  it('keeps the control on every copy', () => {
    const half = define('Rx/2', 1, [['Rx', 0, 0.5]]);
    // Lane 0 is the target, lane 1 the control: C-(Rx(π/2)²) is a controlled X.
    expect(run(half, [0, 0], { ctrl: true, rep: 2 })).toEqual([1, 0, 0, 0]);
    expect(run(half, [0, 1], { ctrl: true, rep: 2 })).toEqual([0, 0, 0, 1]);
  });

  it('works for gates repeated inside other gates', () => {
    const quarter = define('Rx/4', 1, [['Rx', 0, 0.25]]);
    const g = opsToGraph(1, [[`@${quarter.id}`, 0]]);
    let x = 0;
    const nodes = g.nodes.map(({ row, ...n }) => ({ ...n, x: (x += 100), y: row * 110, rep: n.type === 'Custom' ? 2 : undefined }));
    const { def: outer } = groupNodes(nodes, g.wires, 'outer')!;
    defs.set(outer.id, outer);
    expect(run(outer, [0], { rep: 2 })).toEqual([0, 1]); // (Rx(π/4)²)² = Rx(π)
  });

  it('clamps the count and shows it in the title', () => {
    expect(repeats({})).toBe(1);
    expect(repeats({ rep: 0 })).toBe(1);
    expect(repeats({ rep: 2.6 })).toBe(3);
    expect(repeats({ rep: 1000 })).toBe(64);
    const t = define('T', 1, [['T', 0]]);
    expect(nodeTitle({ type: 'Custom', def: t.id, rep: 3 })).toBe('T ×3');
    expect(nodeTitle({ type: 'Custom', def: t.id, rep: 1, dagger: true })).toBe('T†');
  });

  it('is saved with the block', () => {
    const n: NodeData = { id: 1, type: 'Custom', x: 0, y: 0, p: 0, init: 0, def: 'g', rep: 5 };
    expect(nodeData(n).rep).toBe(5);
    expect('rep' in nodeData({ ...n, rep: 1 })).toBe(false);
  });
});

describe('Grover search ×N example', () => {
  const example = EXAMPLES.find((e) => e.name === 'Grover search ×N')!;

  it('has a working CCZ', () => {
    registerExampleGates(example);
    expect(diagonal(blockMatrix({ type: 'Custom', p: 0, def: 'ex-ccz' })!)).toEqual([1, 1, 1, 1, 1, 1, 1, -1]);
  });

  it('finds |111⟩ best with two steps', () => {
    registerExampleGates(example);
    const success = (rep: number) => {
      const g = opsToGraph(example.qubits, example.ops, example.init, [], { ...example.setup, 3: { rep } });
      const nodes = g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row }));
      return simulateCircuit(nodes, g.wires).probabilities![7];
    };
    expect(success(1)).toBeCloseTo(0.78125);
    expect(success(2)).toBeCloseTo(0.9453125);
    expect(success(3)).toBeCloseTo(0.330078125);
  });
});
