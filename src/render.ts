import { defs, measures, nodeTitle, simulateCircuit } from './custom';
import { $ } from './dom';
import { classicalPins, GATES, INITIAL_STATES } from './gates';
import { maxQubit, parseHamiltonian } from './hamiltonian';
import { renderMatrix } from './matrixView';
import { renderOptimizer } from './optimizerRun';
import { renderProbe } from './probe';
import { renderResults } from './results';
import { editor } from './state';
import type { CircuitNode } from './types';
import { drawWires } from './wires';

/**
 * A rotation's angle box: editable normally, but locked to the incoming value
 * while its θ pin is wired (blank if that value differs per measurement branch).
 */
function showAngle(node: CircuitNode, wired: number | undefined): void {
  const input = node.el.querySelector<HTMLInputElement>('input[type="number"]');
  if (!input) return;
  const isWired = editor.cwires.some((w) => w.b === node.id && classicalPins(node).ins[w.bi] === 'θ');
  if (isWired) {
    input.disabled = true;
    input.value = wired == null || Number.isNaN(wired) ? '' : String(Number(wired.toFixed(3)));
    input.placeholder = 'varies';
    input.title = 'Set by the wire into θ';
  } else if (input.disabled) {
    input.disabled = false;
    input.value = String(node.p);
    input.title = '';
  }
}

/** Re-simulates the circuit and updates block labels, measurement readouts, results and wires. */
export function refresh(): void {
  const result = simulateCircuit(editor.nodes, editor.wires, editor.cwires);
  let qubitIndex = 0;

  for (const node of editor.nodes) {
    const el = node.el;
    el.classList.toggle('idle', !result.done.has(node.id));
    $('.tt', el).textContent = node.type === 'Q' ? `q${qubitIndex++}` : nodeTitle(node);

    if (node.type === 'Q') $('.st', el).textContent = INITIAL_STATES[node.init || 0];

    if (node.type === 'M') {
      const p1 = result.measurements.get(node.id);
      $('.m', el).textContent = p1 == null ? 'P(1) —' : `P(1) ${(p1 * 100).toFixed(1)}%`;
      $('.bar i', el).style.width = `${p1 == null ? 0 : p1 * 100}%`;
      $('.md', el).textContent = node.p ? 'Collapse' : 'Peek';
    }

    if (node.type === 'Probe') renderProbe(el, result.probes.get(node.id));

    if (GATES[node.type].param) showAngle(node, result.angles.get(node.id));

    if (node.type === 'Num') {
      // Keep the slider and the number box in step, without fighting the one being typed in.
      for (const input of el.querySelectorAll<HTMLInputElement>('.nv,.ns')) {
        if (document.activeElement !== input) input.value = String(node.p);
      }
    }

    if (node.type === 'Obs') {
      const value = result.classical.get(`${node.id}:0`);
      const parsed = parseHamiltonian(node.text ?? '');
      const cv = $('.cv', node.el);
      cv.classList.toggle('err', !value);
      cv.textContent = value
        ? `⟨H⟩ = ${value[0].toFixed(4)}`
        : 'error' in parsed
          ? parsed.error
          : `Needs ${maxQubit(parsed.terms) + 1} qubit${maxQubit(parsed.terms) ? 's' : ''}`;
    }

    if (node.type === 'Opt') renderOptimizer(node);

    if (node.type === 'Math') {
      const values = result.classical.get(`${node.id}:0`);
      $('.cv', el).textContent = values?.length
        ? `= ${values.map((v) => Number(v.toFixed(4))).join(' or ')}`
        : '= —';
    }

    if (node.type === 'Custom') {
      $('.dg', el).classList.toggle('on', !!node.dagger);
      const cg = $<HTMLButtonElement>('.cg', el);
      cg.classList.toggle('on', !!node.ctrl);
      // A measurement can't be controlled, but an existing control can always be removed.
      cg.disabled = !node.ctrl && measures(node.def!);
      cg.title = cg.disabled ? 'Gates that measure can’t be controlled' : 'Controlled: adds a control qubit';
    }
  }

  editor.sim = result;
  const scope = editor.scopes.at(-1);
  const name = scope && defs.get(scope.defId)?.name;
  renderResults(result, name ? `inside “${name}”, inputs start in |0⟩` : '');
  drawWires();
  renderMatrix();
}
