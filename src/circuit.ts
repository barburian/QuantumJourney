/* Wiring rules for the circuit graph. */
import { pinLabels } from './custom';
import { editor, nodeById } from './state';
import type { CircuitNode, PinRef } from './types';

/** True if `to` can be reached from `from` by following quantum or classical wires forward. */
export function reaches(from: number, to: number): boolean {
  return (
    from === to ||
    editor.wires.some((w) => w.a === from && reaches(w.b, to)) ||
    editor.cwires.some((w) => w.a === from && reaches(w.b, to))
  );
}

/**
 * Wires output `out` to input `into`, replacing any wire already on either pin.
 * Ignored if it would create a loop.
 */
export function link(out: PinRef, into: PinRef): void {
  if (out[0] === into[0] || reaches(into[0], out[0])) return;
  editor.wires = editor.wires.filter(
    (w) => !(w.a === out[0] && w.ai === out[1]) && !(w.b === into[0] && w.bi === into[1]),
  );
  editor.wires.push({ a: out[0], ai: out[1], b: into[0], bi: into[1] });
}

/**
 * Wires a classical output to a classical input, replacing the input's
 * previous wire. Unlike qubits, one value can feed any number of inputs.
 * Returns false if it would create a loop.
 */
export function linkClassical(out: PinRef, into: PinRef): boolean {
  if (out[0] === into[0] || reaches(into[0], out[0])) return false;
  editor.cwires = editor.cwires.filter((w) => !(w.b === into[0] && w.bi === into[1]));
  editor.cwires.push({ a: out[0], ai: out[1], b: into[0], bi: into[1] });
  return true;
}

/**
 * Identifies the qubit whose wire passes through pin `index` of a node: a
 * Qubit block's id, or "id:lane" for a lane of a custom gate's In block. Null
 * if the pin isn't connected to one.
 */
export function sourceQubit(id: number, index: number): string | null {
  const node = nodeById(id);
  if (!node) return null;
  if (node.type === 'Q') return String(id);
  if (node.type === 'In') return `${id}:${index}`;
  const w = editor.wires.find((w) => w.b === id && w.bi === index);
  return w ? sourceQubit(w.a, w.ai) : null;
}

/** Index of the first unconnected output of a node, or -1. */
export function freeOutput(node: CircuitNode): number {
  return pinLabels(node).outs.findIndex((_, i) => !editor.wires.some((w) => w.a === node.id && w.ai === i));
}
