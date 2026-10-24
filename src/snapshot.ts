import { nodeData } from './custom';
import { addNode, clearAll } from './nodes';
import { editor } from './state';
import type { NodeData, Wire } from './types';

export interface Snapshot {
  nodes: NodeData[];
  wires: Wire[];
}

/** The circuit on the canvas as plain data. */
export function snapshot(): Snapshot {
  return {
    nodes: editor.nodes.map(nodeData),
    wires: editor.wires.map((w) => ({ ...w })),
  };
}

/** Replaces the canvas with a circuit. Blocks get new ids. Doesn't fit the view or re-simulate. */
export function loadGraph(g: Snapshot): void {
  clearAll();
  const ids = new Map<number, number>();
  for (const s of g.nodes) {
    ids.set(s.id, addNode(s.type, s.x, s.y, { p: s.p, init: s.init, def: s.def, dagger: s.dagger, ctrl: s.ctrl }).id);
  }
  for (const w of g.wires) {
    const a = ids.get(w.a), b = ids.get(w.b);
    if (a && b) editor.wires.push({ a, ai: w.ai, b, bi: w.bi });
  }
}
