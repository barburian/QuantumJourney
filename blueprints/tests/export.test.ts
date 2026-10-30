import { beforeEach, describe, expect, it } from 'vitest';
import { defs, simulateCircuit } from '../src/custom';
import { EXAMPLES, opsToGraph, registerExampleGates, type Example, type Link, type Op } from '../src/examples';
import { buildProgram, exportCircuit, type Instr, type Program } from '../src/exporter';
import type { GateType, NodeData, Wire } from '../src/types';

/** An example as editor data, with its classical wires. */
function exampleCircuit(example: Example): { nodes: NodeData[]; wires: Wire[]; cwires: Wire[] } {
  registerExampleGates(example);
  const g = opsToGraph(example.qubits, example.ops, example.init, example.links, example.setup);
  return { nodes: g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row })), wires: g.wires, cwires: g.cwires };
}

const SELF_INVERSE = new Set<GateType>(['H', 'X', 'Y', 'Z', 'CNOT', 'CZ', 'SWAP']);

/** The inverse of a gate body: reversed, each gate inverted. */
function inverse(body: Instr[]): Instr[] {
  return body.slice().reverse().map((i): Instr => {
    if (i.kind === 'call') return { ...i, dagger: !i.dagger };
    if (i.kind !== 'gate' || SELF_INVERSE.has(i.type)) return i;
    if (i.type === 'S') return { ...i, type: 'P', angle: -0.5 };
    if (i.type === 'T') return { ...i, type: 'P', angle: -0.25 };
    return { ...i, angle: -(i.angle ?? 0) };
  });
}

/**
 * Replays exported instructions as an op list (custom gates spelled out,
 * measurements collapsing, conditions on single bits as classical wires),
 * independently of how the editor expands its own gates.
 */
function replay(p: Program): { ops: Op[]; links: Link[] } {
  const ops: Op[] = [];
  const links: Link[] = [];
  const bitOp = new Map<number, number>();
  const gates = new Map(p.gates.map((g) => [g.name, g]));
  const run = (body: Instr[], map: (q: number) => number) => {
    for (const i of body) {
      if (i.kind === 'comment') continue;
      if (i.kind === 'measure') {
        bitOp.set(i.bit, ops.length);
        ops.push(['M', map(i.qubit), 1]);
      } else if (i.kind === 'call') {
        if (i.ctrl) throw new Error('replay doesn’t do controlled gates');
        const g = gates.get(i.gate)!;
        run(i.dagger ? inverse(g.body) : g.body, (q) => map(i.qubits[q]));
      } else {
        if (i.cond) {
          if (!('bit' in i.cond)) throw new Error('replay only does single-bit conditions');
          links.push({ from: bitOp.get(i.cond.bit)!, to: ops.length, pin: 'if' });
        }
        ops.push([i.type, ...i.qubits.map(map), ...(i.angle != null ? [i.angle] : [])]);
      }
    }
  };
  run(p.body, (q) => q);
  return { ops, links };
}

const rounded = (v: number[] | undefined) => v?.map((x) => Math.round(x * 1e6) / 1e6);

beforeEach(() => defs.clear());

describe('export', () => {
  it.each(EXAMPLES.map((e) => [e.name, e] as const))('%s: the exported program gives the same results', (_, example) => {
    const c = exampleCircuit(example);
    const program = buildProgram(c.nodes, c.wires, c.cwires);
    const { ops, links } = replay(program);
    const g = opsToGraph(program.qubits, ops, [], links);
    const replayed = simulateCircuit(g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row })), g.wires, g.cwires);
    expect(rounded(replayed.probabilities)).toEqual(rounded(simulateCircuit(c.nodes, c.wires, c.cwires).probabilities));
  });

  it('writes a Bell state as QASM 3', () => {
    const c = exampleCircuit(EXAMPLES.find((e) => e.name === 'Bell state')!);
    expect(exportCircuit('qasm', c.nodes, c.wires)).toBe(
      'OPENQASM 3.0;\ninclude "stdgates.inc";\n\n// Exported from Quantum Blueprints\n\n' +
        'qubit[2] q;\n\nh q[0];\ncx q[0], q[1];\n',
    );
  });

  it('writes a Bell state as Qiskit', () => {
    const c = exampleCircuit(EXAMPLES.find((e) => e.name === 'Bell state')!);
    const py = exportCircuit('qiskit', c.nodes, c.wires);
    expect(py).toContain('q = QuantumRegister(2, "q")\nqc = QuantumCircuit(q)\n\nqc.h(q[0])\nqc.cx(q[0], q[1])\n');
    expect(py).toContain('print(qc.draw())');
  });

  it('turns custom gates into gate definitions, each after the gates it uses', () => {
    const c = exampleCircuit(EXAMPLES.find((e) => e.name === 'Grover search ×N')!);
    const qasm = exportCircuit('qasm', c.nodes, c.wires);
    expect(qasm).toContain('gate ccz a0, a1, a2 {\n  cx a1, a2;\n  p(-0.25*pi) a2;');
    expect(qasm.indexOf('gate ccz')).toBeLessThan(qasm.indexOf('gate grover_step'));
    expect(qasm).toContain('  ccz a0, a1, a2;');
    expect(qasm.match(/^grover_step q\[0\], q\[1\], q\[2\];$/gm)).toHaveLength(2); // repeat ×2
    expect(qasm).toContain('c[2] = measure q[2];');
    const py = exportCircuit('qiskit', c.nodes, c.wires);
    expect(py).toContain('grover_step = QuantumCircuit(3, name="Grover step")');
    expect(py).toContain('grover_step.append(ccz, [0, 1, 2])');
    expect(py).toContain('grover_step = grover_step.to_gate()');
  });

  it('writes inverse and controlled gates with the control first', () => {
    const c = exampleCircuit(EXAMPLES.find((e) => e.name === 'Deutsch')!);
    const block = c.nodes.find((n) => n.type === 'Custom')!;
    Object.assign(block, { dagger: true });
    expect(exportCircuit('qasm', c.nodes, c.wires)).toContain('inv @ oracle_f_x_x q[0], q[1];');
    expect(exportCircuit('qiskit', c.nodes, c.wires)).toContain('qc.append(oracle_f_x_x.inverse(), [q[0], q[1]])');

    // A control qubit: q2 feeds the block's last pin.
    const q2: NodeData = { id: 100, type: 'Q', x: 0, y: 0, p: 0, init: 0 };
    const program = buildProgram([...c.nodes, q2], [...c.wires, { a: 100, ai: 0, b: block.id, bi: 2 }]);
    expect(program.qubits).toBe(3);
    Object.assign(block, { dagger: false, ctrl: true });
    const ctrl = [...c.nodes, q2];
    const wires = [...c.wires, { a: 100, ai: 0, b: block.id, bi: 2 }];
    expect(exportCircuit('qasm', ctrl, wires)).toContain('ctrl @ oracle_f_x_x q[2], q[0], q[1];');
    expect(exportCircuit('qiskit', ctrl, wires)).toContain('qc.append(oracle_f_x_x.control(1), [q[2], q[0], q[1]])');
  });

  it('writes conditions on measured bits as if statements', () => {
    const c = exampleCircuit(EXAMPLES.find((e) => e.name === 'Teleportation')!);
    const qasm = exportCircuit('qasm', c.nodes, c.wires, c.cwires);
    expect(qasm).toContain('bit[2] c;');
    expect(qasm).toContain('if (c[1]) { x q[2]; }');
    expect(qasm).toContain('if (c[0]) { z q[2]; }');
    const py = exportCircuit('qiskit', c.nodes, c.wires, c.cwires);
    expect(py).toContain('with qc.if_test((c[1], 1)):\n    qc.x(q[2])');
  });

  it('writes logic on measured bits as a condition expression', () => {
    // q0 and q1 measured; X on q2 if bit0 xor bit1, Z on q2 if not bit0.
    const ops: Op[] = [['H', 0], ['H', 1], ['M', 0, 1], ['M', 1, 1], ['Math'], ['Math'], ['X', 2], ['Z', 2]];
    const g = opsToGraph(3, ops, [], [{ from: 4, to: 6, pin: 'if' }, { from: 5, to: 7, pin: 'if' }], {
      4: { op: 'xor' },
      5: { op: 'not' },
    });
    const id = (op: number) => 3 + 1 + op;
    const cwires: Wire[] = [
      ...g.cwires,
      { a: id(2), ai: 0, b: id(4), bi: 0 },
      { a: id(3), ai: 0, b: id(4), bi: 1 },
      { a: id(2), ai: 0, b: id(5), bi: 0 },
    ];
    const nodes = g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row }));
    const qasm = exportCircuit('qasm', nodes, g.wires, cwires);
    expect(qasm).toContain('if (c[0] != c[1]) { x q[2]; }');
    expect(qasm).toContain('if (!c[0]) { z q[2]; }');
    const py = exportCircuit('qiskit', nodes, g.wires, cwires);
    expect(py).toContain('from qiskit.circuit.classical import expr');
    expect(py).toContain('with qc.if_test(expr.not_equal(c[0], c[1])):');
    expect(py).toContain('with qc.if_test(expr.logic_not(c[0])):');
  });

  it('uses the current values of classical blocks and notes what it leaves out', () => {
    const c = exampleCircuit(EXAMPLES.find((e) => e.name === 'VQE: H₂ molecule')!);
    const qasm = exportCircuit('qasm', c.nodes, c.wires, c.cwires);
    expect(qasm).toContain('ry(0.1*pi) q[0];');
    expect(qasm).toContain('// Note: The Optimizer’s loop isn’t part of the circuit');
    expect(qasm).toContain('// Note: Expectation blocks aren’t exported. Hamiltonian: -1.0524');
  });

  it('writes initial states and notes unconnected blocks and peeks before gates', () => {
    const g = opsToGraph(2, [['M', 0], ['H', 0]], [3, 1]);
    const nodes = g.nodes.map(({ row, ...n }) => ({ ...n, x: 0, y: row }));
    nodes.push({ id: 50, type: 'X', x: 0, y: 0, p: 0, init: 0 });
    const qasm = exportCircuit('qasm', nodes, g.wires);
    expect(qasm).toContain('// q0 starts in |−⟩\nx q[0];\nh q[0];\n// q1 starts in |1⟩\nx q[1];');
    expect(qasm).toContain('1 block isn’t connected to a qubit');
    expect(qasm).toContain('Peek');
  });

  it('writes out gates that measure instead of defining them', () => {
    const example: Example = {
      name: 't', description: '', qubits: 1,
      gates: [{ id: 'measuring', name: 'Measure twice', lanes: 1, ops: [['H', 0], ['M', 0, 1]] }],
      ops: [['@measuring', 0]],
      setup: { 0: { rep: 2 } },
    };
    const c = exampleCircuit(example);
    const qasm = exportCircuit('qasm', c.nodes, c.wires);
    expect(qasm).not.toContain('gate ');
    expect(qasm).toContain('// Measure twice (1 of 2), written out because it measures\nh q[0];\nc[0] = measure q[0];');
    expect(qasm).toContain('c[1] = measure q[0];');
  });
});
