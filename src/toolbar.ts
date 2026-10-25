import { $ } from './dom';
import { toggleExport } from './exportView';
import { isGateType } from './gates';
import { chain, removeNodes } from './nodes';
import { renderGatePalette } from './palette';
import { groupSelection } from './scope';
import { editor } from './state';
import { canvasCenter, fitToContent, zoomAt } from './viewport';
import { drawWires } from './wires';

/** Drag-and-drop payload for a palette button: the gate type, or "Custom:<definition id>". */
export function dragPayload(button: HTMLElement): string | undefined {
  const { t, def } = button.dataset;
  return t === 'Custom' ? `Custom:${def}` : t;
}

export function initToolbar(): void {
  const palette = $('#pal');
  palette.innerHTML =
    '<div id="gates"></div>' +
    '<div class="grp"><button class="p" id="mk" title="Turn the selected blocks into a reusable gate (Ctrl+G). ' +
    'Shift-click or shift-drag to select several.">Make gate</button></div>' +
    '<div class="grp"><label class="chk"><input type="checkbox" id="auto" checked>Auto-connect</label>' +
    '<label class="chk" title="Wire thickness shows P(1), colour shows phase, a glow marks entanglement">' +
    '<input type="checkbox" id="live" checked>Live wires</label>' +
    '<button class="p" id="zo" title="Zoom out">−</button><button class="p" id="zi" title="Zoom in">+</button>' +
    '<button class="p" id="ft">Fit</button><button class="p" id="clr">Clear</button>' +
    '<button class="p" id="ex" title="The circuit as OpenQASM 3 or Qiskit code">Export</button></div>';
  renderGatePalette();

  palette.addEventListener('dragstart', (e) => {
    const payload = dragPayload(e.target as HTMLElement);
    if (payload) e.dataTransfer?.setData('text/plain', payload);
  });
  palette.addEventListener('click', (e) => {
    const { t, def } = (e.target as HTMLElement).dataset ?? {};
    if (t && isGateType(t)) chain(t, undefined, undefined, def ? { def } : {});
  });

  $('#mk').addEventListener('click', groupSelection);

  const auto = $<HTMLInputElement>('#auto');
  editor.autoConnect = auto.checked;
  auto.addEventListener('change', () => (editor.autoConnect = auto.checked));

  const live = $<HTMLInputElement>('#live');
  editor.liveWires = live.checked;
  live.addEventListener('change', () => {
    editor.liveWires = live.checked;
    drawWires();
  });

  $('#zi').addEventListener('click', () => zoomAt(...canvasCenter(), 1.25));
  $('#zo').addEventListener('click', () => zoomAt(...canvasCenter(), 0.8));
  $('#ft').addEventListener('click', () => {
    fitToContent();
    drawWires();
  });
  $('#ex').addEventListener('click', toggleExport);
  // Inside a custom gate this keeps its Inputs and Outputs blocks.
  $('#clr').addEventListener('click', () => removeNodes([...editor.nodes]));
}
