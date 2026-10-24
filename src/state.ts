import type { SimResult } from './simulator';
import type { CircuitNode, Wire } from './types';

/** The circuit being edited, plus editor selection state. */
export const editor = {
  nodes: [] as CircuitNode[],
  wires: [] as Wire[],
  lastId: 0,
  /** The block the user selected. */
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
};

export const nodeById = (id: number): CircuitNode | undefined => editor.nodes.find((n) => n.id === id);
