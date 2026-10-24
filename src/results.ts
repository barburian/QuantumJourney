import { $ } from './dom';
import { MAX_QUBITS, type SimResult } from './simulator';

const MAX_ROWS = 16;

export function renderResults(r: SimResult): void {
  const el = $('#res');
  if (!r.qubits) {
    el.innerHTML = '<h2>Add a Qubit to begin</h2>';
    return;
  }
  if (!r.probabilities) {
    el.innerHTML = `<h2>Too many qubits <span>(limit is ${MAX_QUBITS} in this prototype)</span></h2>`;
    return;
  }

  // Non-zero states in basis order; if there are too many, keep only the most likely.
  let rows = r.probabilities.map((v, i): [number, number] => [i, v]).filter(([, v]) => v > 1e-6);
  if (rows.length > MAX_ROWS) rows = rows.sort((a, b) => b[1] - a[1]).slice(0, MAX_ROWS);
  rows.sort((a, b) => a[0] - b[0]);

  const branches = r.branches && r.branches > 1 ? ` · ${r.branches} measurement branches` : '';
  el.innerHTML =
    `<h2>Final probabilities <span>basis |q${r.qubits - 1}…q0⟩${branches}</span></h2>` +
    rows
      .map(
        ([i, v]) =>
          `<div class="r"><span class="k">|${i.toString(2).padStart(r.qubits, '0')}⟩</span>` +
          `<div class="tr"><i style="width:${(v * 100).toFixed(2)}%"></i></div>` +
          `<span class="v">${(v * 100).toFixed(1)}%</span></div>`,
      )
      .join('');
}
