import type { SimResult } from './simulator';
import type { CircuitNode, NodeData, Wire } from './types';

/** A custom gate being edited, and what to return to. */
export interface Scope {
  defId: string;
  parent: { nodes: NodeData[]; wires: Wire[]; view: { zoom: number; x: number; y: number } };
}

/** The circuit being edited, plus editor selection state. */
export const editor = {
  nodes: [] as CircuitNode[],
  wires: [] as Wire[],
  lastId: 0,
  /** Selected blocks. */
  selection: new Set<CircuitNode>(),
  /** The most recently selected block; new gates chain onto it. */
  selected: null as CircuitNode | null,
  /** The block added most recently; new gates chain onto it when nothing is selected. */
  last: null as CircuitNode | null,
  autoConnect: true,
  /** Draw wires with their qubit's state (thickness, phase colour, entanglement glow, flow). */
  liveWires: true,
  /** The most recent simulation. */
  sim: null as SimResult | null,
  /** SVG path of the wire currently being dragged, or ''. */
  pendingWire: '',
  /** Custom gates being edited, outermost first; empty on the main circuit. */
  scopes: [] as Scope[],
};

export const nodeById = (id: number): CircuitNode | undefined => editor.nodes.find((n) => n.id === id);
