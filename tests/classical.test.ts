import { beforeEach, describe, expect, it } from 'vitest';
import { defs, groupNodes, simulateCircuit } from '../src/custom';
import { EXAMPLES, opsToGraph, type Link, type Op } from '../src/examples';
import { mathOp } from '../src/gates';
import type { NodeData } from '../src/types';

/** Runs an op list with classical links; returns the result and the node id of each op. */
function run(qubits: number, ops: Op[], links: Link[] = [], init?: number[]) {
  const g = opsToGraph(qubits, ops, init, links);
  const nodes: NodeData[] = g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row * 110 }));
  const r = simulateCircuit(nodes, g.wires, g.cwires);
  return { r, op: (i: number) => qubits + 1 + i, nodes, g };
}

const rounded = (p: number[] | undefined) => p?.map((v) => Math.round(v * 1e9) / 1e9 + 0);

beforeEach(() => defs.clear());

describe('math', () => {
  it.each([
    ['+', 2, 3, 5], ['−', 2, 3, -1], ['×', 2, 3, 6], ['÷', 3, 2, 1.5],
    ['xor', 1, 1, 0], ['xor', 1, 0, 1], ['and', 1, 0, 0], ['or', 0, 2, 1], ['not', 0, 0, 1], ['not', 5, 0, 0],
  ])('%s(%d, %d) = %d', (op, a, b, out) => expect(mathOp(op, a, b)).toBe(out));
});

describe('angles from classical wires', () => {
  it('a Number sets the angle of the rotations it feeds', () => {
    // Rx(π) on both qubits flips them.
    const { r, op } = run(2, [['Num', 1], ['Rx', 0, 0.123], ['Rx', 1]], [
      { from: 0, to: 1, pin: 'θ' }, { from: 0, to: 2, pin: 'θ' },
    ]);
    expect(rounded(r.probabilities)).toEqual([0, 0, 0, 1]);
    expect(r.angles.get(op(1))).toBe(1);
    expect(r.classical.get(`${op(0)}:0`)).toEqual([1]);
    expect(r.done.has(op(0))).toBe(true);
  });

  it('the Shared angle example drives three rotations from one value', () => {
    const ex = EXAMPLES.find((e) => e.name === 'Shared angle')!;
    const { r } = run(ex.qubits, ex.ops, ex.links);
    // Ry(π/4) on each qubit: P(1) = sin²(π/8) each.
    const p1 = Math.sin(Math.PI / 8) ** 2;
    for (const q of [0, 1, 2]) expect(r.pins.get(`${5 + q}:0`)!.p1).toBeCloseTo(p1);
  });

  it('an inverted custom gate negates a wired angle', () => {
    // Gate: Num 0.3 → Ry. U then U† is the identity.
    const inner = run(1, [['Num', 0.3], ['Ry', 0]], [{ from: 0, to: 1, pin: 'θ' }]);
    const grouped = groupNodes(inner.nodes, inner.g.wires, 'R', undefined, inner.g.cwires)!;
    expect(grouped.cut).toBe(0);
    defs.set(grouped.def.id, grouped.def);
    const id = grouped.def.id;
    const nodes: NodeData[] = [
      { id: 1, type: 'Q', x: 0, y: 0, p: 0, init: 0 },
      { id: 2, type: 'Custom', x: 0, y: 0, p: 0, init: 0, def: id },
      { id: 3, type: 'Custom', x: 0, y: 0, p: 0, init: 0, def: id, dagger: true },
    ];
    const wires = [{ a: 1, ai: 0, b: 2, bi: 0 }, { a: 2, ai: 0, b: 3, bi: 0 }];
    expect(rounded(simulateCircuit(nodes, wires).probabilities)).toEqual([1, 0]);
    expect(simulateCircuit(nodes.slice(0, 2), wires.slice(0, 1)).probabilities![1]).toBeCloseTo(Math.sin(0.15 * Math.PI) ** 2);
  });

  it('grouping reports classical wires it would cut', () => {
    const c = run(1, [['Num', 0.3], ['Ry', 0]], [{ from: 0, to: 1, pin: 'θ' }]);
    const ry = c.nodes.find((n) => n.type === 'Ry')!;
    expect(groupNodes([ry], c.g.wires, 'R', undefined, c.g.cwires)!.cut).toBe(1);
  });
});

describe('measurement bits and conditional gates', () => {
  it('a gate conditioned on a collapsed bit only acts in that branch', () => {
    // Measure |+⟩ on q0; flip q1 if the bit is 1: q1 copies the outcome.
    const { r, op } = run(2, [['H', 0], ['M', 0, 1], ['X', 1]], [{ from: 1, to: 2, pin: 'if' }]);
    expect(rounded(r.probabilities)).toEqual([0.5, 0, 0, 0.5]);
    expect(r.classical.get(`${op(1)}:0`)).toEqual([0, 1]);
  });

  it('a peek measurement has no bit, so its conditional gate waits', () => {
    const { r, op } = run(2, [['H', 0], ['M', 0, 0], ['X', 1]], [{ from: 1, to: 2, pin: 'if' }]);
    expect(r.done.has(op(2))).toBe(false);
  });

  it('logic on bits: flip q2 only if both measurements gave 1', () => {
    const { r } = run(
      3,
      [['X', 0], ['X', 1], ['M', 0, 1], ['M', 1, 1], ['Num', 0], ['X', 2]],
      [{ from: 4, to: 5, pin: 'if' }],
    );
    // A Number 0 never fires.
    expect(rounded(r.probabilities)![0b011]).toBe(1);
  });

  it('teleportation delivers the original state', () => {
    const ex = EXAMPLES.find((e) => e.name === 'Teleportation')!;
    const { r, op } = run(ex.qubits, ex.ops, ex.links);
    const probe = r.probes.get(op(9))!;
    const t = 0.6 * Math.PI;
    expect(probe.bloch[0]).toBeCloseTo(Math.sin(t));
    expect(probe.bloch[1]).toBeCloseTo(0);
    expect(probe.bloch[2]).toBeCloseTo(Math.cos(t));
    expect(probe.branches).toBe(4);
  });

  it('without the corrections the received state is scrambled', () => {
    const ex = EXAMPLES.find((e) => e.name === 'Teleportation')!;
    const { r, op } = run(ex.qubits, ex.ops, []);
    expect(Math.hypot(...r.probes.get(op(9))!.bloch)).toBeLessThan(0.9);
  });
});
