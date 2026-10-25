/*
 * Exporting a circuit as an OpenQASM 3 file or a Qiskit (Python) program.
 * The circuit is first turned into a list of instructions, which each format
 * then writes out. Custom gates become gate definitions; gates that measure
 * can't be gates in either format, so they are written out inline.
 * Classical blocks become their current values, and gates conditional on
 * measured bits become if statements.
 */
import { defs, invert, measures, pinLabels, repeats, type Local } from './custom';
import { classicalPins, GATES, INITIAL_STATE_GATES, INITIAL_STATES, mathOp } from './gates';
import type { GateType, NodeData, Wire } from './types';

/** A condition on measured bits. */
export type Cond = { bit: number } | { op: 'not' | 'and' | 'or' | 'xor'; args: Cond[] };

export type Instr =
  /** A primitive gate; `angle` is in multiples of π. */
  | { kind: 'gate'; type: GateType; qubits: number[]; angle?: number; cond?: Cond }
  /** A custom gate; with `ctrl`, the control qubit is the last of `qubits`. */
  | { kind: 'call'; gate: string; qubits: number[]; dagger: boolean; ctrl: boolean }
  | { kind: 'measure'; qubit: number; bit: number }
  | { kind: 'comment'; text: string };

export interface GateDefinition {
  /** Identifier, unique among the gates and safe in both formats. */
  name: string;
  /** The gate's name in the editor. */
  label: string;
  lanes: number;
  body: Instr[];
}

export interface Program {
  qubits: number;
  bits: number;
  /** Custom gates, each after the gates it uses. */
  gates: GateDefinition[];
  body: Instr[];
  /** Things the export couldn't keep, or that work differently in the export. */
  notes: string[];
}

export type Format = 'qasm' | 'qiskit';

/* ---------- circuit → instructions ---------- */

/** Names the formats use themselves. */
const RESERVED = new Set([
  'q', 'c', 'qc', 'pi', 'expr', 'gate', 'qubit', 'bit', 'measure', 'if', 'else', 'for', 'while', 'in', 'ctrl', 'inv',
  'pow', 'reset', 'barrier', 'h', 'x', 'y', 'z', 's', 't', 'rx', 'ry', 'rz', 'p', 'cx', 'cz', 'swap', 'cp', 'U', 'not',
  'and', 'or', 'def', 'class', 'from', 'import', 'return', 'None', 'True', 'False', 'is', 'lambda', 'with', 'as',
]);

class Builder {
  bits = 0;
  gates = new Map<string, GateDefinition>();
  names = new Set<string>();
  notes = new Set<string>();

  identifier(label: string): string {
    let base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'gate';
    if (/^\d/.test(base)) base = `g_${base}`;
    if (RESERVED.has(base)) base = `${base}_gate`;
    let name = base;
    for (let k = 2; this.names.has(name); k++) name = `${base}_${k}`;
    this.names.add(name);
    return name;
  }

  /** Adds a custom gate's definition (after those it uses) and returns its name. */
  gate(id: string): string {
    const known = this.gates.get(id);
    if (known) return known.name;
    const def = defs.get(id)!;
    const body: Instr[] = [];
    const inId = def.nodes.find((n) => n.type === 'In')?.id;
    const sources = new Map(Array.from({ length: def.lanes }, (_, k) => [`${inId}:${k}`, k] as const));
    walk(def.nodes, def.wires, def.cwires ?? [], sources, body, this, def.name);
    const gate = { name: this.identifier(def.name), label: def.name, lanes: def.lanes, body };
    this.gates.set(id, gate);
    return gate.name;
  }
}

/** A classical value: a number known now, a condition on measured bits, or neither. */
type Value = { num: number } | { cond: Cond } | null;

/**
 * Adds the instructions of one (sub)circuit. `sources` gives the qubit leaving
 * each Qubit or In block's output ("id:pin").
 */
function walk(
  nodes: readonly Local[], wires: readonly Wire[], cwires: readonly Wire[],
  sources: Map<string, number>, out: Instr[], b: Builder, scope: string,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const at = new Map(sources);
  const done = new Set<number>();
  /** Measurement block id → its classical bit. */
  const bitOf = new Map<number, number>();
  const feed = (id: number, pin: number) => cwires.find((w) => w.b === id && w.bi === pin);

  const value = (id: number, pin: number): Value => {
    const n = byId.get(id);
    if (!n) return null;
    switch (n.type) {
      case 'Num': return { num: n.p };
      case 'Opt': return { num: n.vals?.[pin] ?? 0 };
      case 'M': return bitOf.has(id) ? { cond: { bit: bitOf.get(id)! } } : null;
      case 'Math': {
        const args = classicalPins(n).ins.map((_, i) => {
          const w = feed(id, i);
          return w ? value(w.a, w.ai) : null;
        });
        if (args.some((a) => !a)) return null;
        if (args.every((a) => 'num' in a!)) {
          const [x, y = 0] = args.map((a) => (a as { num: number }).num);
          return { num: mathOp(n.op, x, y) };
        }
        return logic(n.op ?? '+', args as NonNullable<Value>[]);
      }
      default: return null;
    }
  };

  /** Classical inputs are ready once every measurement they depend on has been written. */
  const classicalReady = (id: number): boolean =>
    cwires.filter((w) => w.b === id).every((w) => {
      const src = byId.get(w.a);
      if (src?.type === 'M') return done.has(src.id);
      return src?.type !== 'Math' || classicalReady(src.id);
    });

  let skipped = 0;
  for (let progress = true; progress; ) {
    progress = false;
    for (const n of nodes) {
      if (done.has(n.id) || ['Q', 'In', 'Out'].includes(n.type) || GATES[n.type].kind === 'cl') continue;
      const ins = pinLabels(n).ins;
      const qubits = ins.map((_, i) => {
        const w = wires.find((w) => w.b === n.id && w.bi === i);
        return w ? at.get(`${w.a}:${w.ai}`) : undefined;
      });
      if (qubits.some((q) => q == null) || !classicalReady(n.id)) continue;
      done.add(n.id);
      progress = true;
      const qs = qubits as number[];
      qs.forEach((q, i) => at.set(`${n.id}:${i}`, q));
      if (!emit(n, qs)) skipped++;
    }
  }
  const unused = nodes.filter((n) => !done.has(n.id) && !['Q', 'In', 'Out'].includes(n.type) && GATES[n.type].kind !== 'cl');
  if (unused.length) b.notes.add(`${where(scope)}${unused.length} block${unused.length > 1 ? 's aren’t' : ' isn’t'} connected to a qubit and ${unused.length > 1 ? 'were' : 'was'} left out.`);
  if (skipped) b.notes.add(`${where(scope)}gates whose “if” value is always 0 were left out.`);

  /** Writes one block; false if it was left out. */
  function emit(n: Local, qubits: number[]): boolean {
    if (n.type === 'Probe') return true;

    if (n.type === 'M') {
      const bit = b.bits++;
      bitOf.set(n.id, bit);
      out.push({ kind: 'measure', qubit: qubits[0], bit });
      if (!n.p && leadsToGate(n.id)) {
        b.notes.add('A measurement set to Peek is followed by more gates. In the editor Peek doesn’t disturb the ' +
          'qubit, but a real measurement collapses it, so the results can differ.');
      }
      return true;
    }

    if (n.type === 'Custom') {
      const def = defs.get(n.def!);
      if (!def) return false;
      const times = repeats(n);
      if (!measures(def.id)) {
        const gate = b.gate(def.id);
        for (let k = 0; k < times; k++) out.push({ kind: 'call', gate, qubits, dagger: !!n.dagger, ctrl: !!n.ctrl });
        return true;
      }
      // Measuring gates aren't unitary, so they can't be gates: write them out here (they can't be controlled).
      const inner: Local[] = n.dagger ? def.nodes.map(invert) : def.nodes;
      const innerWires = n.dagger ? def.wires.map((w) => ({ a: w.b, ai: w.bi, b: w.a, bi: w.ai })) : def.wires;
      const inId = inner.find((x) => x.type === 'In')?.id;
      for (let k = 0; k < times; k++) {
        out.push({ kind: 'comment', text: `${def.name}${n.dagger ? '†' : ''}${times > 1 ? ` (${k + 1} of ${times})` : ''}, written out because it measures` });
        const lanes = new Map(qubits.map((q, i) => [`${inId}:${i}`, q] as const));
        walk(inner, innerWires, def.cwires ?? [], lanes, out, b, def.name);
      }
      return true;
    }

    const pins = classicalPins(n).ins;
    let angle: number | undefined;
    if (GATES[n.type].param) {
      angle = n.p;
      const w = feed(n.id, pins.indexOf('θ'));
      if (w) {
        const v = value(w.a, w.ai);
        if (v && 'num' in v) angle = v.num * (n.sign ?? 1);
        else b.notes.add(`${where(scope)}an angle that depends on measured bits was exported as its typed value.`);
      }
    }
    let cond: Cond | undefined;
    if (n.cond) {
      const w = feed(n.id, pins.indexOf('if'));
      const v = w ? value(w.a, w.ai) : null;
      if (!v) return false;
      if ('num' in v) {
        if (!v.num) return false;
      } else cond = v.cond;
    }
    out.push({ kind: 'gate', type: n.type, qubits, angle, cond });
    return true;
  }

  /** True if a measurement's qubit goes on into another gate (Probes don't count). */
  function leadsToGate(id: number): boolean {
    const w = wires.find((w) => w.a === id && w.ai === 0);
    const next = w && byId.get(w.b);
    if (!next || next.type === 'Out') return false;
    return next.type === 'Probe' ? leadsToGate(next.id) : true;
  }

  /** Combines values with a logic operation; arithmetic on measured bits isn't supported. */
  function logic(op: string, args: NonNullable<Value>[]): Value {
    const [a, c] = args;
    const truth = (v: NonNullable<Value>) => ('num' in v ? !!v.num : null);
    const bitCond = (v: NonNullable<Value>) => (v as { cond: Cond }).cond;
    const not = (x: Cond): Cond => ('op' in x && x.op === 'not' ? x.args[0] : { op: 'not', args: [x] });
    switch (op) {
      case 'not': return { cond: not(bitCond(a)) };
      case 'and': case 'or': case 'xor': {
        // Fold a constant side away: x and 1 = x, x or 1 = 1, x xor 1 = not x, …
        const k = truth(a) ?? truth(c);
        if (k == null) return { cond: { op, args: [bitCond(a), bitCond(c)] } };
        const x = bitCond(truth(a) == null ? a : c);
        if (op === 'and') return k ? { cond: x } : { num: 0 };
        if (op === 'or') return k ? { num: 1 } : { cond: x };
        return { cond: k ? not(x) : x };
      }
      default:
        b.notes.add(`${where(scope)}a condition doing arithmetic (${op}) on measured bits can’t be exported; those gates were left out.`);
        return null;
    }
  }
}

const where = (scope: string) => (scope ? `In ${scope}: ` : '');

/**
 * Turns a circuit into instructions. Qubit k is the k-th Qubit block; when
 * editing inside a custom gate, its input lanes follow them and start in |0⟩.
 */
export function buildProgram(nodes: readonly NodeData[], wires: readonly Wire[], cwires: readonly Wire[] = []): Program {
  const b = new Builder();
  const body: Instr[] = [];
  const sources = new Map<string, number>();
  let qubits = 0;
  for (const n of nodes) {
    if (n.type === 'Q') {
      const q = qubits++;
      sources.set(`${n.id}:0`, q);
      const prep = INITIAL_STATE_GATES[n.init || 0];
      if (prep.length) body.push({ kind: 'comment', text: `q${q} starts in ${INITIAL_STATES[n.init]}` });
      for (const type of prep) body.push({ kind: 'gate', type, qubits: [q] });
    }
  }
  for (const n of nodes) {
    if (n.type !== 'In') continue;
    for (let k = 0; k < (defs.get(n.def!)?.lanes ?? 0); k++) sources.set(`${n.id}:${k}`, qubits++);
  }
  walk(nodes, wires, cwires, sources, body, b, '');

  const opt = nodes.find((n) => n.type === 'Opt');
  if (opt) {
    const vals = (opt.vals ?? []).map((v, i) => `θ${i} = ${num(v)}`).join(', ');
    b.notes.add(`The Optimizer’s loop isn’t part of the circuit; its angles are exported at their current values (${vals}).`);
  }
  for (const n of nodes) {
    if (n.type === 'Obs') b.notes.add(`Expectation blocks aren’t exported. Hamiltonian: ${(n.text ?? '').trim().replace(/\s+/g, ' ')}`);
  }
  return { qubits, bits: b.bits, gates: [...b.gates.values()], body, notes: [...b.notes] };
}

/* ---------- instructions → text ---------- */

const num = (v: number) => String(Number(v.toFixed(6)));

/** An angle given in multiples of π, as an expression. */
function angleText(v: number): string {
  if (v === 0) return '0';
  if (v === 1) return 'pi';
  if (v === -1) return '-pi';
  return `${num(v)}*pi`;
}

const QASM_NAMES: Partial<Record<GateType, string>> = {
  H: 'h', X: 'x', Y: 'y', Z: 'z', S: 's', T: 't', Rx: 'rx', Ry: 'ry', Rz: 'rz', P: 'p',
  CNOT: 'cx', CZ: 'cz', SWAP: 'swap', CP: 'cp',
};

/** A call's qubits in the order both formats expect: the control first. */
const callQubits = (i: { qubits: number[]; ctrl: boolean }) => (i.ctrl ? [i.qubits.at(-1)!, ...i.qubits.slice(0, -1)] : i.qubits);

function qasmCond(c: Cond, top = true): string {
  if ('bit' in c) return `c[${c.bit}]`;
  const [a, b] = c.args.map((x) => qasmCond(x, false));
  const text = c.op === 'not' ? `!${a}` : `${a} ${{ and: '&&', or: '||', xor: '!=' }[c.op]} ${b}`;
  return top || c.op === 'not' ? text : `(${text})`;
}

function qasmLines(body: Instr[], qubit: (q: number) => string, indent: string): string[] {
  return body.map((i) => {
    switch (i.kind) {
      case 'comment': return `${indent}// ${i.text}`;
      case 'measure': return `${indent}c[${i.bit}] = measure ${qubit(i.qubit)};`;
      case 'call': {
        const mods = `${i.ctrl ? 'ctrl @ ' : ''}${i.dagger ? 'inv @ ' : ''}`;
        return `${indent}${mods}${i.gate} ${callQubits(i).map(qubit).join(', ')};`;
      }
      case 'gate': {
        const args = i.angle != null ? `(${angleText(i.angle)})` : '';
        const stmt = `${QASM_NAMES[i.type]}${args} ${i.qubits.map(qubit).join(', ')};`;
        return `${indent}${i.cond ? `if (${qasmCond(i.cond)}) { ${stmt} }` : stmt}`;
      }
    }
  });
}

function toQasm(p: Program): string {
  const lines = ['OPENQASM 3.0;', 'include "stdgates.inc";', '', '// Exported from Quantum Blueprints'];
  lines.push(...p.notes.map((n) => `// Note: ${n}`));
  for (const g of p.gates) {
    const args = Array.from({ length: g.lanes }, (_, k) => `a${k}`);
    lines.push('', `// ${g.label}`, `gate ${g.name} ${args.join(', ')} {`);
    lines.push(...qasmLines(g.body, (q) => args[q], '  '), '}');
  }
  lines.push('');
  if (p.qubits) lines.push(`qubit[${p.qubits}] q;`);
  if (p.bits) lines.push(`bit[${p.bits}] c;`);
  if (p.qubits) lines.push('', ...qasmLines(p.body, (q) => `q[${q}]`, ''));
  return lines.join('\n') + '\n';
}

function qiskitCond(c: Cond): string {
  if ('bit' in c) return `c[${c.bit}]`;
  const [a, b] = c.args.map(qiskitCond);
  if (c.op === 'not') return `expr.logic_not(${a})`;
  return `expr.${{ and: 'logic_and', or: 'logic_or', xor: 'not_equal' }[c.op]}(${a}, ${b})`;
}

function qiskitLines(body: Instr[], circuit: string, qubit: (q: number) => string): string[] {
  const lines: string[] = [];
  for (const i of body) {
    switch (i.kind) {
      case 'comment':
        lines.push(`# ${i.text}`);
        break;
      case 'measure':
        lines.push(`${circuit}.measure(${qubit(i.qubit)}, c[${i.bit}])`);
        break;
      case 'call': {
        const gate = `${i.gate}${i.dagger ? '.inverse()' : ''}${i.ctrl ? '.control(1)' : ''}`;
        lines.push(`${circuit}.append(${gate}, [${callQubits(i).map(qubit).join(', ')}])`);
        break;
      }
      case 'gate': {
        const args = [...(i.angle != null ? [angleText(i.angle)] : []), ...i.qubits.map(qubit)];
        const stmt = `${circuit}.${QASM_NAMES[i.type]}(${args.join(', ')})`;
        if (!i.cond) lines.push(stmt);
        else lines.push(`with ${circuit}.if_test(${'bit' in i.cond ? `(c[${i.cond.bit}], 1)` : qiskitCond(i.cond)}):`, `    ${stmt}`);
        break;
      }
    }
  }
  return lines;
}

function toQiskit(p: Program): string {
  const usesExpr = p.body.some((i) => i.kind === 'gate' && i.cond && !('bit' in i.cond));
  const lines = [
    'from math import pi',
    '',
    'from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister',
    ...(usesExpr ? ['from qiskit.circuit.classical import expr'] : []),
    '',
    '# Exported from Quantum Blueprints',
    ...p.notes.map((n) => `# Note: ${n}`),
  ];
  for (const g of p.gates) {
    lines.push('', `${g.name} = QuantumCircuit(${g.lanes}, name=${JSON.stringify(g.label)})`);
    lines.push(...qiskitLines(g.body, g.name, String), `${g.name} = ${g.name}.to_gate()`);
  }
  lines.push('', `q = QuantumRegister(${p.qubits}, "q")`);
  if (p.bits) lines.push(`c = ClassicalRegister(${p.bits}, "c")`);
  lines.push(`qc = QuantumCircuit(q${p.bits ? ', c' : ''})`, '');
  lines.push(...qiskitLines(p.body, 'qc', (q) => `q[${q}]`), '', 'print(qc.draw())');
  return lines.join('\n') + '\n';
}

export function exportCircuit(
  format: Format, nodes: readonly NodeData[], wires: readonly Wire[], cwires: readonly Wire[] = [],
): string {
  const program = buildProgram(nodes, wires, cwires);
  return format === 'qasm' ? toQasm(program) : toQiskit(program);
}
