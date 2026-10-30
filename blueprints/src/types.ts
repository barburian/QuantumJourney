export type GateType =
  | 'Q'
  | 'H' | 'X' | 'Y' | 'Z' | 'S' | 'T'
  | 'Rx' | 'Ry' | 'Rz' | 'P'
  | 'CNOT' | 'CZ' | 'SWAP' | 'CP'
  | 'M' | 'Probe'
  | 'Custom' | 'In' | 'Out'
  | 'Num' | 'Math' | 'Obs' | 'Opt';

/**
 * How a block is drawn: qubit source, square tile, rotation tile, full card
 * with labelled rows, or classical block.
 */
export type GateKind = 'q' | 'sq' | 'rot' | 'full' | 'cl';

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
 * parametrised gates, the collapse flag (0 = peek, 1 = collapse) for
 * measurements and the value of a Number block. `init` indexes the initial
 * state of a qubit.
 */
export interface NodeData {
  id: number;
  type: GateType;
  x: number;
  y: number;
  p: number;
  init: number;
  /** Custom gate definition used by a Custom block, or owned by an In/Out block. */
  def?: string;
  /** Custom block runs its definition inverted. */
  dagger?: boolean;
  /** Custom block has an extra control pin after its lanes. */
  ctrl?: boolean;
  /** Gate has a classical "if" input: it only acts when that value is non-zero. */
  cond?: boolean;
  /** Operation of a Math block; see MATH_OPS. */
  op?: string;
  /** Hamiltonian of an Expectation block, as text (see hamiltonian.ts). */
  text?: string;
  /** Current parameter values of an Optimizer block, one per output. */
  vals?: number[];
  /** Whether an Optimizer lowers or raises its cost. */
  goal?: 'min' | 'max';
  /** Maximum steps of an Optimizer run. (Its learning rate is `p`.) */
  steps?: number;
  /** How many times a custom gate runs in a row (default 1). */
  rep?: number;
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
