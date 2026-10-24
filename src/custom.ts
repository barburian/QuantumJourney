/*
 * Custom gates: reusable subcircuits. A definition is a small circuit whose
 * boundary is an In block (one output per lane) and an Out block (one input
 * per lane). A Custom block runs a definition, optionally inverted (dagger)
 * and/or controlled by one extra qubit. For simulation, Custom blocks are
 * expanded recursively into primitive gates.
 */
import { GATES, gateLabel } from './gates';
import { simulate, type SimNode, type SimResult } from './simulator';
import type { NodeData, PinRef, Wire } from './types';

export interface CustomDef {
  id: string;
  name: string;
  /** Number of qubits the gate acts on. */
  lanes: number;
  /** The subcircuit, including exactly one In and one Out block. */
  nodes: NodeData[];
  wires: Wire[];
}

/** All custom gate definitions, by id. */
export const defs = new Map<string, CustomDef>();

/** The plain data of a block, without anything the editor attached to it. */
export function nodeData({ id, type, x, y, p, init, def, dagger, ctrl }: NodeData): NodeData {
  const n: NodeData = { id, type, x, y, p, init };
  if (def) n.def = def;
  if (dagger) n.dagger = true;
  if (ctrl) n.ctrl = true;
  return n;
}

const laneLabels =(lanes: number) => Array.from({ length: lanes }, (_, i) => `lane ${i}`);

/** Input and output pin labels of any block, including custom ones. */
export function pinLabels(node: Pick<NodeData, 'type' | 'def' | 'ctrl'>): { ins: string[]; outs: string[] } {
  const lanes = laneLabels((node.def && defs.get(node.def)?.lanes) || 0);
  switch (node.type) {
    case 'Custom': {
      const pins = node.ctrl ? [...lanes, 'control'] : lanes;
      return { ins: pins, outs: pins };
    }
    case 'In': return { ins: [], outs: lanes };
    case 'Out': return { ins: lanes, outs: [] };
    default: return GATES[node.type];
  }
}

/** Header text of a block. */
export function nodeTitle(node: Pick<NodeData, 'type' | 'def' | 'ctrl' | 'dagger'>): string {
  if (node.type !== 'Custom') return gateLabel(node.type);
  const name = defs.get(node.def!)?.name ?? 'Missing gate';
  return `${node.ctrl ? 'C-' : ''}${name}${node.dagger ? '†' : ''}`;
}

const customNodes =(def: CustomDef | undefined) => def?.nodes.filter((n) => n.type === 'Custom') ?? [];

/** True if definition `id` is `target` or uses it, directly or nested. */
export function uses(id: string, target: string): boolean {
  return id === target || customNodes(defs.get(id)).some((n) => uses(n.def!, target));
}

/** True if a definition measures (directly or nested); such gates can't be controlled. */
export function measures(id: string): boolean {
  const def = defs.get(id);
  return !!def?.nodes.some((n) => n.type === 'M' || (n.type === 'Custom' && measures(n.def!)));
}

export function newDefId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ---------- grouping a selection into a definition ---------- */

export interface Grouping {
  def: CustomDef;
  /** Per lane: the outside output that fed it, if any. */
  sources: (PinRef | null)[];
  /** Per lane: the outside input it fed, if any. */
  targets: (PinRef | null)[];
}

/**
 * Turns blocks into a definition. Every input not fed from inside the group
 * starts a lane; the lane follows the qubit through the group to the output
 * where it leaves. Lanes are ordered top to bottom by `pinY`, the height of
 * each lane's first input pin. Qubit and In/Out blocks are left out.
 */
export function groupNodes(
  selected: readonly NodeData[],
  wires: readonly Wire[],
  name: string,
  pinY: (node: NodeData, pin: number) => number = (node, pin) => node.y + pin * 30,
): Grouping | null {
  const nodes = selected.filter((n) => n.type !== 'Q' && n.type !== 'In' && n.type !== 'Out');
  if (!nodes.length) return null;
  const inside = new Set(nodes.map((n) => n.id));

  const lanes: { node: NodeData; pin: number; source: PinRef | null; exit: PinRef; target: PinRef | null }[] = [];
  for (const node of nodes) {
    pinLabels(node).ins.forEach((_, pin) => {
      const w = wires.find((w) => w.b === node.id && w.bi === pin);
      if (w && inside.has(w.a)) return;
      // Follow the qubit: a block's input i always leaves through its output i.
      let at: PinRef = [node.id, pin];
      for (;;) {
        const out = wires.find((w) => w.a === at[0] && w.ai === at[1]);
        if (out && inside.has(out.b)) {
          at = [out.b, out.bi];
          continue;
        }
        lanes.push({ node, pin, source: w ? [w.a, w.ai] : null, exit: at, target: out ? [out.b, out.bi] : null });
        break;
      }
    });
  }
  lanes.sort((a, b) => pinY(a.node, a.pin) - pinY(b.node, b.pin));

  const id = newDefId();
  const maxId = Math.max(...nodes.map((n) => n.id));
  const inId = maxId + 1, outId = maxId + 2;
  const minX = Math.min(...nodes.map((n) => n.x)), maxX = Math.max(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const def: CustomDef = {
    id,
    name,
    lanes: lanes.length,
    nodes: [
      { id: inId, type: 'In', x: minX - 170, y: minY, p: 0, init: 0, def: id },
      ...nodes.map(nodeData),
      { id: outId, type: 'Out', x: maxX + 200, y: minY, p: 0, init: 0, def: id },
    ],
    wires: [
      ...wires.filter((w) => inside.has(w.a) && inside.has(w.b)).map((w) => ({ ...w })),
      ...lanes.map((l, k) => ({ a: inId, ai: k, b: l.node.id, bi: l.pin })),
      ...lanes.map((l, k) => ({ a: l.exit[0], ai: l.exit[1], b: outId, bi: k })),
    ],
  };
  return { def, sources: lanes.map((l) => l.source), targets: lanes.map((l) => l.target) };
}

/* ---------- expansion for simulation ---------- */

/** The inverse of one block. Wires are reversed separately, so In and Out swap roles. */
function invert(n: NodeData): NodeData {
  switch (n.type) {
    case 'S': return { ...n, type: 'P', p: -0.5 };
    case 'T': return { ...n, type: 'P', p: -0.25 };
    case 'Rx': case 'Ry': case 'Rz': case 'P': case 'CP': return { ...n, p: -n.p };
    case 'In': return { ...n, type: 'Out' };
    case 'Out': return { ...n, type: 'In' };
    case 'Custom': return { ...n, dagger: !n.dagger };
    // H, X, Y, Z, CNOT, CZ and SWAP are their own inverses; probes and measurements stay as they are.
    default: return n;
  }
}

/** The blocks that will run (all inputs fed from the In block), in an order they can run in. */
function runOrder(nodes: readonly NodeData[], wires: readonly Wire[]): NodeData[] {
  const fed = new Set(nodes.filter((n) => n.type === 'In').map((n) => n.id));
  const order: NodeData[] = [];
  for (let progress = true; progress; ) {
    progress = false;
    for (const n of nodes) {
      if (fed.has(n.id) || n.type === 'Out' || n.type === 'Q') continue;
      const ok = pinLabels(n).ins.every((_, i) => {
        const w = wires.find((w) => w.b === n.id && w.bi === i);
        return w && fed.has(w.a);
      });
      if (ok) {
        fed.add(n.id);
        order.push(n);
        progress = true;
      }
    }
  }
  return order;
}

interface Expansion {
  nodes: SimNode[];
  wires: Wire[];
  inId: number;
  outId: number;
}

/**
 * Expands a definition into primitive blocks with fresh ids. With `controls`
 * > 0, that many control lanes enter the In block after the gate's own lanes
 * and are threaded through every block that runs, so each one becomes
 * controlled.
 */
function expand(def: CustomDef, dagger: boolean, controls: number, fresh: () => number, depth = 0): Expansion {
  if (depth > 32) throw new Error(`Custom gate "${def.name}" contains itself`);
  const local = dagger ? def.nodes.map(invert) : def.nodes;
  const localWires = dagger ? def.wires.map((w) => ({ a: w.b, ai: w.bi, b: w.a, bi: w.ai })) : def.wires;

  const nodes: SimNode[] = [];
  const wires: Wire[] = [];
  /** Local id → [id that receives its input wires, id its output wires leave from]. */
  const ends = new Map<number, [number, number]>();
  let inId = 0, outId = 0;

  for (const n of local) {
    if (n.type === 'Custom') {
      const sub = defs.get(n.def!);
      if (!sub) continue;
      const e = expand(sub, !!n.dagger, (n.ctrl ? 1 : 0) + controls, fresh, depth + 1);
      nodes.push(...e.nodes);
      wires.push(...e.wires);
      ends.set(n.id, [e.inId, e.outId]);
      continue;
    }
    const id = fresh();
    const boundary = n.type === 'In' || n.type === 'Out';
    nodes.push({ id, type: n.type, p: n.p, init: 0, arity: boundary ? def.lanes : GATES[n.type].ins.length, controls });
    ends.set(n.id, [id, id]);
    if (n.type === 'In') inId = id;
    if (n.type === 'Out') outId = id;
  }

  for (const w of localWires) {
    const a = ends.get(w.a), b = ends.get(w.b);
    if (a && b) wires.push({ a: a[1], ai: w.ai, b: b[0], bi: w.bi });
  }

  if (controls) {
    const order = runOrder(local, localWires);
    for (let j = 0; j < controls; j++) {
      let prev: PinRef = [inId, def.lanes + j];
      for (const n of order) {
        const pin = pinLabels(n).ins.length + j;
        const [into, out] = ends.get(n.id)!;
        wires.push({ a: prev[0], ai: prev[1], b: into, bi: pin });
        prev = [out, pin];
      }
      wires.push({ a: prev[0], ai: prev[1], b: outId, bi: def.lanes + j });
    }
  }

  return { nodes, wires, inId, outId };
}

/**
 * Simulates a circuit that may contain Custom blocks. Inside a definition
 * (the circuit has an In block) the In block's lanes start in |0⟩. Pin states
 * and `done` are reported for Custom blocks as for any other block.
 */
export function simulateCircuit(nodes: readonly NodeData[], wires: readonly Wire[]): SimResult {
  let lastId = 0;
  const fresh = () => --lastId; // negative, so never equal to a real block id
  const flat: SimNode[] = [];
  const flatWires: Wire[] = [];
  const ends = new Map<number, [number, number]>();
  const instances: { id: number; outId: number; pins: number }[] = [];

  for (const n of nodes) {
    const def = n.def ? defs.get(n.def) : undefined;
    if (n.type === 'Custom') {
      if (!def) continue;
      const e = expand(def, !!n.dagger, n.ctrl ? 1 : 0, fresh);
      flat.push(...e.nodes);
      flatWires.push(...e.wires);
      ends.set(n.id, [e.inId, e.outId]);
      instances.push({ id: n.id, outId: e.outId, pins: def.lanes + (n.ctrl ? 1 : 0) });
      continue;
    }
    if (n.type === 'In') {
      for (let k = 0; k < (def?.lanes ?? 0); k++) {
        const q = fresh();
        flat.push({ id: q, type: 'Q', p: 0, init: 0 });
        flatWires.push({ a: q, ai: 0, b: n.id, bi: k });
      }
    }
    const boundary = n.type === 'In' || n.type === 'Out';
    flat.push({ id: n.id, type: n.type, p: n.p, init: n.init, arity: boundary ? def?.lanes ?? 0 : undefined });
    ends.set(n.id, [n.id, n.id]);
  }

  for (const w of wires) {
    const a = ends.get(w.a), b = ends.get(w.b);
    if (a && b) flatWires.push({ a: a[1], ai: w.ai, b: b[0], bi: w.bi });
  }

  const result = simulate(flat, flatWires);
  for (const inst of instances) {
    if (result.done.has(inst.outId)) result.done.add(inst.id);
    for (let k = 0; k < inst.pins; k++) {
      const state = result.pins.get(`${inst.outId}:${k}`);
      if (state) result.pins.set(`${inst.id}:${k}`, state);
    }
  }
  return result;
}
