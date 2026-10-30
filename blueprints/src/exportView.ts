/* The export panel: the circuit as OpenQASM 3 or Qiskit code, to copy or download. */
import { $, notify } from './dom';
import { exportCircuit, type Format } from './exporter';
import { editor } from './state';

const FORMAT_KEY = 'qb-export-format';
const FORMATS: Record<Format, { label: string; file: string; type: string }> = {
  qasm: { label: 'OpenQASM 3', file: 'circuit.qasm', type: 'text/plain' },
  qiskit: { label: 'Qiskit', file: 'circuit.py', type: 'text/x-python' },
};

let format: Format = 'qasm';
try {
  if (localStorage.getItem(FORMAT_KEY) === 'qiskit') format = 'qiskit';
} catch {
  // Storage unavailable: start with QASM.
}
let code = '';

export const exportOpen = (): boolean => !$('#exp').hidden;

export function toggleExport(): void {
  $('#exp').hidden = exportOpen();
  renderExport();
}

export function closeExport(): void {
  $('#exp').hidden = true;
}

/** Rewrites the code for the current circuit, if the panel is open. */
export function renderExport(): void {
  const panel = $('#exp');
  if (panel.hidden) return;
  code = exportCircuit(format, editor.nodes, editor.wires, editor.cwires);
  $('code', panel).textContent = code;
  for (const tab of panel.querySelectorAll<HTMLElement>('[data-f]')) tab.classList.toggle('on', tab.dataset.f === format);
}

function download(): void {
  const { file, type } = FORMATS[format];
  const name = ($<HTMLInputElement>('#nm').value.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'circuit') +
    file.slice(file.lastIndexOf('.'));
  const url = URL.createObjectURL(new Blob([code], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initExport(): void {
  const panel = $('#exp');
  const tabs = (Object.keys(FORMATS) as Format[])
    .map((f) => `<button class="p tab" data-f="${f}">${FORMATS[f].label}</button>`)
    .join('');
  panel.innerHTML =
    `<div class="mh"><b>Export</b>${tabs}<span class="fill"></span>` +
    '<button class="p" id="exc" title="Copy to the clipboard">Copy</button>' +
    '<button class="p" id="exd" title="Save as a file">Download</button>' +
    '<b class="mxc" title="Close (Esc)">×</b></div>' +
    '<pre class="code"><code></code></pre>' +
    '<p class="cap">Updates as you edit. Custom gates become gate definitions; Number, Math and Optimizer ' +
    'blocks are exported as their current values.</p>';

  panel.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const tab = target.closest<HTMLElement>('[data-f]');
    if (tab) {
      format = tab.dataset.f as Format;
      try {
        localStorage.setItem(FORMAT_KEY, format);
      } catch {
        // Storage unavailable: the choice lasts until reload.
      }
      renderExport();
    } else if (target.closest('#exc')) {
      navigator.clipboard.writeText(code).then(
        () => notify(`Copied the ${FORMATS[format].label} code.`),
        () => notify('Couldn’t copy: select the code and copy it by hand.'),
      );
    } else if (target.closest('#exd')) {
      download();
    } else if (target.closest('.mxc')) {
      closeExport();
    }
  });
}
