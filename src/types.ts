export type GateType =
  | 'Q'
  | 'H' | 'X' | 'Y' | 'Z' | 'S' | 'T'
  | 'Rx' | 'Ry' | 'Rz' | 'P'
  | 'CNOT' | 'CZ' | 'SWAP' | 'CP'
  | 'M' | 'Probe';

/** How a block is drawn: qubit source, square tile, rotation tile, or full card with labelled rows. */
export type GateKind = 'q' | 'sq' | 'rot' | 'full';

export interface GateDef {
  color: string;
  kind: GateKind;
  /** Input pin labels (one per qubit the gate acts on). */
  ins: string[];
  /** Output pin labels. */
  outs: string[];
  /** Takes an angle parameter, in multiples of π. */
  param?: boolean;
  /** Measurement block. */
  measure?: boolean;
  /** Probe block: passes its qubit through unchanged and displays its state. */
  probe?: boolean;
}

/**
 * The serialisable part of a block. `p` is the angle (in multiples of π) for
 * parametrised gates and the collapse flag (0 = peek, 1 = collapse) for
 * measurements. `init` indexes the initial state of a qubit.
 */
export interface NodeData {
  id: number;
  type: GateType;
  x: number;
  y: number;
  p: number;
  init: number;
}

export interface CircuitNode extends NodeData {
  el: HTMLDivElement;
}

/** Connects output `ai` of node `a` to input `bi` of node `b`. */
export interface Wire {
  a: number;
  ai: number;
  b: number;
  bi: number;
}

export type Point = [x: number, y: number];

/** A pin reference: [node id, pin index]. */
export type PinRef = [id: number, index: number];
