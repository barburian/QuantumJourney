/*
 * Gradient-based optimisation for variational circuits: finite-difference
 * gradients (so parameters can pass through Math blocks) and Adam steps.
 * Parameters are angles in multiples of π, like the rest of the editor.
 */

export interface AdamState {
  m: number[];
  v: number[];
  t: number;
}

export const newAdam = (n: number): AdamState => ({ m: new Array(n).fill(0), v: new Array(n).fill(0), t: 0 });

/** Step used for the finite-difference gradient. */
const H = 1e-3;

export function gradient(f: (x: number[]) => number, x: number[]): number[] {
  return x.map((_, i) => {
    const up = x.slice(), down = x.slice();
    up[i] += H;
    down[i] -= H;
    return (f(up) - f(down)) / (2 * H);
  });
}

/**
 * One Adam step that lowers f (or raises it with `maximise`). Returns the new
 * point, the cost there and the gradient's size, which is ~0 at an optimum.
 */
export function adamStep(
  f: (x: number[]) => number, x: number[], s: AdamState, lr: number, maximise = false,
): { x: number[]; cost: number; gradNorm: number } {
  const sign = maximise ? -1 : 1;
  const g = gradient(f, x).map((v) => sign * v);
  s.t++;
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  const next = x.map((xi, i) => {
    s.m[i] = b1 * s.m[i] + (1 - b1) * g[i];
    s.v[i] = b2 * s.v[i] + (1 - b2) * g[i] * g[i];
    const mHat = s.m[i] / (1 - b1 ** s.t), vHat = s.v[i] / (1 - b2 ** s.t);
    return xi - (lr * mHat) / (Math.sqrt(vHat) + eps);
  });
  return { x: next, cost: f(next), gradNorm: Math.hypot(...g) };
}

/** Runs Adam until the gradient vanishes or `steps` is reached. Returns the best point found. */
export function minimise(
  f: (x: number[]) => number, x0: number[], { lr = 0.05, steps = 300, maximise = false } = {},
): { x: number[]; cost: number; history: number[] } {
  const s = newAdam(x0.length);
  let x = x0.slice();
  let best = { x, cost: f(x) };
  const history = [best.cost];
  for (let k = 0; k < steps; k++) {
    const r = adamStep(f, x, s, lr, maximise);
    x = r.x;
    history.push(r.cost);
    if (maximise ? r.cost > best.cost : r.cost < best.cost) best = { x, cost: r.cost };
    if (r.gradNorm < 1e-5) break;
  }
  return { ...best, history };
}
