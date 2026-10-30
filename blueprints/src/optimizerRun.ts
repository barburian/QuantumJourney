/* Running Optimizer blocks on the live circuit, and drawing their progress. */
import { simulateCircuit } from './custom';
import { $ } from './dom';
import { adamStep, newAdam, type AdamState } from './optimizer';
import { editor, nodeById } from './state';
import type { CircuitNode } from './types';

/** Delay between steps while running, so the canvas visibly updates. */
const TICK_MS = 30;

interface Run {
  history: number[];
  adam: AdamState;
  steps: number;
  running: boolean;
  timer: number;
  status: string;
}

const runs = new Map<number, Run>();

function runOf(node: CircuitNode): Run {
  let run = runs.get(node.id);
  if (!run || run.adam.m.length !== node.vals!.length) {
    run = { history: run?.history ?? [], adam: newAdam(node.vals!.length), steps: 0, running: false, timer: 0, status: '' };
    runs.set(node.id, run);
  }
  return run;
}

/** The cost as a function of the parameters, or an explanation of why there is none. */
function costFunction(node: CircuitNode): ((vals: number[]) => number) | string {
  const w = editor.cwires.find((w) => w.b === node.id && w.bi === 0);
  if (!w) return 'Wire an Expectation block into cost.';
  return (vals) => {
    const saved = node.vals;
    node.vals = vals;
    const values = simulateCircuit(editor.nodes, editor.wires, editor.cwires).classical.get(`${w.a}:${w.ai}`);
    node.vals = saved;
    return values?.length === 1 ? values[0] : NaN;
  };
}

/** One optimisation step. Returns false when the run should stop. */
function step(node: CircuitNode, refresh: () => void): boolean {
  const run = runOf(node);
  const f = costFunction(node);
  if (typeof f === 'string') {
    run.status = f;
    return false;
  }
  if (!run.history.length) run.history.push(f(node.vals!));
  if (Number.isNaN(run.history[0])) {
    run.status = 'The cost has no single value yet (is the circuit complete?).';
    run.history = [];
    return false;
  }
  const r = adamStep(f, node.vals!, run.adam, node.p || 0.05, node.goal === 'max');
  node.vals = r.x;
  run.history.push(r.cost);
  run.steps++;
  run.status = `step ${run.steps} · cost ${r.cost.toFixed(4)}`;
  refresh();
  if (r.gradNorm < 1e-5) {
    run.status += ' · converged';
    return false;
  }
  return run.steps < (node.steps ?? 200);
}

function stop(node: CircuitNode): void {
  const run = runOf(node);
  run.running = false;
  clearTimeout(run.timer);
}

/** Handles an Optimizer button: run/stop, step, reset, add or remove a parameter. */
export function optimizerAction(node: CircuitNode, action: string, refresh: () => void, rebuild: () => void): void {
  const run = runOf(node);
  switch (action) {
    case 'run': {
      if (run.running) {
        stop(node);
        break;
      }
      run.running = true;
      if (run.steps >= (node.steps ?? 200)) run.steps = 0;
      const tick = () => {
        if (!run.running || !nodeById(node.id)) return;
        if (step(node, refresh)) run.timer = window.setTimeout(tick, TICK_MS);
        else stop(node);
        renderOptimizer(node);
      };
      tick();
      break;
    }
    case 'step':
      stop(node);
      step(node, refresh);
      break;
    case 'reset':
      stop(node);
      node.vals = node.vals!.map(() => Math.round((Math.random() - 0.5) * 50) / 100);
      runs.delete(node.id);
      runOf(node).status = 'New random start.';
      break;
    case 'add':
    case 'del':
      stop(node);
      if (action === 'add') node.vals!.push(0.1);
      else if (node.vals!.length > 1) {
        const last = node.vals!.length - 1;
        editor.cwires = editor.cwires.filter((w) => !(w.a === node.id && w.ai === last));
        node.vals!.pop();
      }
      runs.delete(node.id);
      rebuild();
      break;
  }
  refresh();
}

/** Updates an Optimizer block: parameter values, run button, status and cost chart. */
export function renderOptimizer(node: CircuitNode): void {
  const run = runOf(node);
  node.el.querySelectorAll<HTMLElement>('.pval').forEach((el) => {
    el.textContent = `θ${el.dataset.v} = ${node.vals![Number(el.dataset.v)].toFixed(3)}`;
  });
  const button = $('.run', node.el);
  button.textContent = run.running ? '■ Stop' : '▶ Run';
  button.title = run.running ? 'Stop optimising' : `Optimise for up to ${node.steps ?? 200} steps`;
  $('.os', node.el).textContent = run.status || 'Press Run to optimise.';

  const h = run.history.filter(Number.isFinite);
  let svg = '';
  if (h.length > 1) {
    const lo = Math.min(...h), hi = Math.max(...h), span = hi - lo || 1;
    const pts = h.map((v, i) => `${((i / (h.length - 1)) * 160).toFixed(1)},${(44 - ((v - lo) / span) * 40).toFixed(1)}`);
    svg =
      `<polyline points="${pts.join(' ')}"/>` +
      `<text x="2" y="9">${hi.toFixed(3)}</text><text x="2" y="46">${lo.toFixed(3)}</text>`;
  }
  $('.chart', node.el).innerHTML = svg;
}
