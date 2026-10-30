import { beforeEach, describe, expect, it } from 'vitest';
import { defs, groupNodes } from '../src/custom';
import { opsToGraph, type Op } from '../src/examples';
import { blockMatrix, formatComplex, reverseQubitOrder, type Complex } from '../src/matrix';
import type { GateType, NodeData } from '../src/types';

const R = Math.SQRT1_2;
const gate = (type: GateType, p = 0, extra: Partial<NodeData> = {}) => ({ type, p, ...extra });
/** Matrix entries as [re, im] pairs, rounded. */
const entries = (m: Complex[][] | null) =>
  m?.map((row) => row.map(({ re, im }) => [Math.round(re * 1e6) / 1e6 + 0, Math.round(im * 1e6) / 1e6 + 0]));
/** A real matrix as [re, 0] pairs. */
const real = (rows: number[][]) => rows.map((row) => row.map((v) => [Math.round(v * 1e6) / 1e6 + 0, 0]));

function define(ops: Op[], lanes: number): string {
  const g = opsToGraph(lanes, ops);
  const nodes = g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row * 110 }));
  const { def } = groupNodes(nodes, g.wires, 'G', (n, pin) => {
    const w = g.wires.find((w) => w.b === n.id && w.bi === pin)!;
    return g.nodes.find((q) => q.id === w.a)!.row;
  })!;
  defs.set(def.id, def);
  return def.id;
}

beforeEach(() => defs.clear());

describe('blockMatrix', () => {
  it('single-qubit gates', () => {
    expect(entries(blockMatrix(gate('H')))).toEqual(real([[R, R], [R, -R]]));
    expect(entries(blockMatrix(gate('X')))).toEqual(real([[0, 1], [1, 0]]));
    expect(entries(blockMatrix(gate('S')))).toEqual([[[1, 0], [0, 0]], [[0, 0], [0, 1]]]);
    expect(entries(blockMatrix(gate('Y')))).toEqual([[[0, 0], [0, -1]], [[0, 1], [0, 0]]]);
  });

  it('rotations use their angle', () => {
    // Rx(π) = −iX
    expect(entries(blockMatrix(gate('Rx', 1)))).toEqual([[[0, 0], [0, -1]], [[0, -1], [0, 0]]]);
  });

  it('CNOT with control on pin 0 (the least significant bit)', () => {
    expect(entries(blockMatrix(gate('CNOT')))).toEqual(
      real([[1, 0, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0], [0, 1, 0, 0]]),
    );
  });

  it('textbook order puts pin 0 first', () => {
    expect(entries(reverseQubitOrder(blockMatrix(gate('CNOT'))!))).toEqual(
      real([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0]]),
    );
  });

  it('custom gates, inverted and controlled', () => {
    const s = define([['S', 0]], 1);
    expect(entries(blockMatrix(gate('Custom', 0, { def: s, dagger: true })))).toEqual([[[1, 0], [0, 0]], [[0, 0], [0, -1]]]);
    const x = define([['X', 0]], 1);
    // Controlled X with the control on pin 1 = CNOT(control 1, target 0).
    expect(entries(blockMatrix(gate('Custom', 0, { def: x, ctrl: true })))).toEqual(
      real([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0]]),
    );
  });

  it('is unitary for a bigger custom gate', () => {
    const id = define([['H', 0], ['CNOT', 0, 1], ['Ry', 2, 0.3], ['CP', 1, 2, 0.25]], 3);
    const m = blockMatrix(gate('Custom', 0, { def: id }))!;
    // U†U = I
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        let re = 0, im = 0;
        for (let k = 0; k < 8; k++) {
          re += m[k][i].re * m[k][j].re + m[k][i].im * m[k][j].im;
          im += m[k][i].re * m[k][j].im - m[k][i].im * m[k][j].re;
        }
        expect(re).toBeCloseTo(i === j ? 1 : 0);
        expect(im).toBeCloseTo(0);
      }
    }
  });

  it('is null for a gate that collapses a measurement', () => {
    const id = define([['H', 0], ['M', 0, 1]], 1);
    expect(blockMatrix(gate('Custom', 0, { def: id }))).toBeNull();
  });
});

describe('formatComplex', () => {
  it.each([
    [{ re: 0, im: 0 }, '0'],
    [{ re: 1, im: 0 }, '1'],
    [{ re: -1, im: 1e-12 }, '−1'],
    [{ re: 0, im: 1 }, 'i'],
    [{ re: 0, im: -1 }, '−i'],
    [{ re: R, im: 0 }, '0.707'],
    [{ re: 0.5, im: -0.5 }, '0.5−0.5i'],
    [{ re: R, im: R }, '0.707+0.707i'],
  ])('%o → %s', (z, text) => expect(formatComplex(z)).toBe(text));
});
