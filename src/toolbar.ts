import { $ } from './dom';
import { GATES, gateLabel, isGateType, PALETTE_GROUPS } from './gates';
import { chain, clearAll } from './nodes';
import { refresh } from './render';
import { editor } from './state';
import { canvasCenter, fitToContent, zoomAt } from './viewport';
import { drawWires } from './wires';

export function initToolbar(): void {
  const palette = $('#pal');
  const groups = PALETTE_GROUPS.map(
    ([title, gates]) =>
      `<div class="grp"><small>${title}</small>` +
      gates
        .map((t) => `<button draggable="true" data-t="${t}" style="--c:${GATES[t].color}">${gateLabel(t)}</button>`)
        .join('') +
      '</div>',
  ).join('');
  palette.innerHTML =
    groups +
    '<div class="grp"><label class="chk"><input type="checkbox" id="auto" checked>Auto-connect</label>' +
    '<button class="p" id="zo" title="Zoom out">−</button><button class="p" id="zi" title="Zoom in">+</button>' +
    '<button class="p" id="ft">Fit</button><button class="p" id="clr">Clear</button></div>';

  const gateOf = (e: Event) => (e.target as HTMLElement).dataset?.t;
  palette.addEventListener('dragstart', (e) => {
    const t = gateOf(e);
    if (t) e.dataTransfer?.setData('text/plain', t);
  });
  palette.addEventListener('click', (e) => {
    const t = gateOf(e);
    if (t && isGateType(t)) chain(t);
  });

  const auto = $<HTMLInputElement>('#auto');
  editor.autoConnect = auto.checked;
  auto.addEventListener('change', () => (editor.autoConnect = auto.checked));

  $('#zi').addEventListener('click', () => zoomAt(...canvasCenter(), 1.25));
  $('#zo').addEventListener('click', () => zoomAt(...canvasCenter(), 0.8));
  $('#ft').addEventListener('click', () => {
    fitToContent();
    drawWires();
  });
  $('#clr').addEventListener('click', () => {
    clearAll();
    refresh();
  });
}
