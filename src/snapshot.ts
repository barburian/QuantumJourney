import { nodeData } from './custom';
import { addNode, clearAll } from './nodes';
import { editor } from './state';
import type { NodeData, Wire } from './types';

export interface Snapshot {
  nodes: NodeData[];
  wires: Wire[];
  /** Classical wires; absent in circuits saved before they existed. */
  cwires?: Wire[];
}

/** The circuit on the canvas as plain data. */
export function snapshot(): Required<Snapshot> {
  return {
    nodes: editor.nodes.map(nodeData),
    wires: editor.wires.map((w) => ({ ...w })),
    cwires: editor.cwires.map((w) => ({ ...w })),
  };
}

/** Replaces the canvas with a circuit. Blocks get new ids. Doesn't fit the view or re-simulate. */
export function loadGraph(g: Snapshot): void {
  clearAll();
  const ids = new Map<number, number>();
  for (const s of g.nodes) {
    const { p, init, def, dagger, ctrl, cond, op, text, vals, goal, steps, rep } = s;
    ids.set(s.id, addNode(s.type, s.x, s.y, { p, init, def, dagger, ctrl, cond, op, text, vals, goal, steps, rep }).id);
  }
  const remap = (list: Wire[] | undefined, into: Wire[]) => {
    for (const w of list ?? []) {
      const a = ids.get(w.a), b = ids.get(w.b);
      if (a && b) into.push({ a, ai: w.ai, b, bi: w.bi });
    }
  };
  remap(g.wires, editor.wires);
  remap(g.cwires, editor.cwires);
}
