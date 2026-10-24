import { $ } from './dom';
import { gateLabel, INITIAL_STATES } from './gates';
import { renderResults } from './results';
import { simulate } from './simulator';
import { editor } from './state';
import { drawWires } from './wires';

/** Re-simulates the circuit and updates block labels, measurement readouts, results and wires. */
export function refresh(): void {
  const result = simulate(editor.nodes, editor.wires);
  let qubitIndex = 0;

  for (const node of editor.nodes) {
    const el = node.el;
    el.classList.toggle('idle', !result.done.has(node.id));
    $('.tt', el).textContent = node.type === 'Q' ? `q${qubitIndex++}` : gateLabel(node.type);

    if (node.type === 'Q') $('.st', el).textContent = INITIAL_STATES[node.init || 0];

    if (node.type === 'M') {
      const p1 = result.measurements.get(node.id);
      $('.m', el).textContent = p1 == null ? 'P(1) —' : `P(1) ${(p1 * 100).toFixed(1)}%`;
      $('.bar i', el).style.width = `${p1 == null ? 0 : p1 * 100}%`;
      $('.md', el).textContent = node.p ? 'Collapse' : 'Peek';
    }
  }

  renderResults(result);
  drawWires();
}
