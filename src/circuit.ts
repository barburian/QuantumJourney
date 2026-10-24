/* Wiring rules for the circuit graph. */
import { GATES } from './gates';
import { editor, nodeById } from './state';
import type { CircuitNode, PinRef } from './types';

/** True if `to` can be reached from `from` by following wires forward. */
export function reaches(from: number, to: number): boolean {
  return from === to || editor.wires.some((w) => w.a === from && reaches(w.b, to));
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

/** Id of the Qubit node whose wire passes through pin `index` of a node, or null if it isn't connected. */
export function sourceQubit(id: number, index: number): number | null {
  const node = nodeById(id);
  if (!node) return null;
  if (node.type === 'Q') return id;
  const w = editor.wires.find((w) => w.b === id && w.bi === index);
  return w ? sourceQubit(w.a, w.ai) : null;
}

/** Index of the first unconnected output of a node, or -1. */
export function freeOutput(node: CircuitNode): number {
  return GATES[node.type].outs.findIndex((_, i) => !editor.wires.some((w) => w.a === node.id && w.ai === i));
}
