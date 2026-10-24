import { defs, measures, nodeTitle, simulateCircuit } from './custom';
import { $ } from './dom';
import { INITIAL_STATES } from './gates';
import { renderMatrix } from './matrixView';
import { renderProbe } from './probe';
import { renderResults } from './results';
import { editor } from './state';
import { drawWires } from './wires';

/** Re-simulates the circuit and updates block labels, measurement readouts, results and wires. */
export function refresh(): void {
  const result = simulateCircuit(editor.nodes, editor.wires);
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
