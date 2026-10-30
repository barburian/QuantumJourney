/*
 * Hamiltonians written as sums of Pauli terms, e.g. "-1.05 + 0.4 Z0 - 0.18 X0 X1",
 * and their expectation values. Qubit k is the k-th Qubit block (q0 is the
 * least significant basis bit, as in the results).
 */

export type Pauli = 'X' | 'Y' | 'Z';

export interface Term {
  coef: number;
  ops: { pauli: Pauli; qubit: number }[];
}

export type Parsed = { terms: Term[] } | { error: string };

/**
 * Parses a sum of terms. Each term is an optional coefficient followed by
 * Pauli factors such as Z0, X1 or Y2 (spaces or * between them are optional);
 * a term with no factors is a constant. "I" factors are ignored.
 */
export function parseHamiltonian(text: string): Parsed {
  const src = text.replace(/[−–]/g, '-').replace(/\s+/g, ' ').trim();
  if (!src) return { error: 'Enter a Hamiltonian, e.g. Z0 + 0.5 X0 X1' };
  const terms: Term[] = [];
  // Split into signed terms, keeping signs that start a term (not those inside numbers like 1e-3).
  const parts = src.split(/(?<![eE])(?=[+-])/).map((s) => s.trim()).filter(Boolean);
  for (const signed of parts) {
    // Quote terms in errors without their sign.
    const part = signed.replace(/^[+-]\s*/, '');
    let rest = signed;
    let sign = 1;
    while (/^[+-]/.test(rest)) {
      if (rest[0] === '-') sign = -sign;
      rest = rest.slice(1).trim();
    }
    const num = rest.match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*\*?\s*/i);
    let coef = 1;
    if (num) {
      coef = parseFloat(num[0]);
      rest = rest.slice(num[0].length);
    }
    const ops: Term['ops'] = [];
    const seen = new Set<number>();
    for (const f of rest.split(/[\s*]+/).filter(Boolean)) {
      for (const m of f.matchAll(/([XYZI])(\d+)|(\S)/gi)) {
        if (m[3]) return { error: `Can’t read “${part}”: expected factors like Z0 or X1` };
        const pauli = m[1].toUpperCase();
        if (pauli === 'I') continue;
        const qubit = Number(m[2]);
        if (seen.has(qubit)) return { error: `Qubit ${qubit} appears twice in “${part}”` };
        seen.add(qubit);
        ops.push({ pauli: pauli as Pauli, qubit });
      }
    }
    if (!num && !ops.length) return { error: `Can’t read “${part}”` };
    terms.push({ coef: sign * coef, ops });
  }
  return { terms };
}

/** Highest qubit index a Hamiltonian uses, or −1. */
export const maxQubit = (terms: Term[]): number => Math.max(-1, ...terms.flatMap((t) => t.ops.map((o) => o.qubit)));

/** ⟨ψ|P|ψ⟩ for one Pauli string P (always real for a normalised state). */
function pauliExpectation(ops: Term['ops'], re: Float64Array, im: Float64Array): number {
  let flip = 0, zMask = 0, yMask = 0;
  for (const { pauli, qubit } of ops) {
    const bit = 1 << qubit;
    if (pauli !== 'Z') flip |= bit;
    if (pauli !== 'X') zMask |= bit;
    if (pauli === 'Y') yMask |= bit;
  }
  // P|i⟩ = phase(i)·|i ⊕ flip⟩ with phase = i^(#Y) · (−1)^(popcount(i & zMask)),
  // using Y = i·X·Z (Y|0⟩ = i|1⟩, Y|1⟩ = −i|0⟩).
  const ys = popcount(yMask) % 4;
  let sum = 0;
  for (let i = 0; i < re.length; i++) {
    if (!re[i] && !im[i]) continue;
    const j = i ^ flip;
    const sign = popcount(i & zMask) % 2 ? -1 : 1;
    // conj(ψ_j) · phase · ψ_i, real part only.
    let pr = sign * re[i], pi = sign * im[i];
    for (let k = 0; k < ys; k++) [pr, pi] = [-pi, pr]; // multiply by i
    sum += re[j] * pr + im[j] * pi;
  }
  return sum;
}

function popcount(v: number): number {
  let c = 0;
  for (; v; v &= v - 1) c++;
  return c;
}

/** ⟨ψ|H|ψ⟩ for a state vector. */
export function expectation(terms: Term[], re: Float64Array, im: Float64Array): number {
  return terms.reduce((s, t) => s + t.coef * (t.ops.length ? pauliExpectation(t.ops, re, im) : 1), 0);
}
