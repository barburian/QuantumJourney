import { defs, uses } from './custom';
import { $, escapeHtml } from './dom';
import { GATES, gateLabel, PALETTE_GROUPS } from './gates';
import { onGatesChanged } from './gateStore';
import { editor } from './state';

/**
 * Renders the gate buttons, including a group for custom gates. Inside a
 * custom gate, qubits can't be added and gates that would contain themselves
 * are hidden.
 */
export function renderGatePalette(): void {
  const editing = editor.scopes.at(-1)?.defId;
  const button = (attrs: string, color: string, label: string) =>
    `<button draggable="true" ${attrs} style="--c:${color}">${label}</button>`;

  const groups = PALETTE_GROUPS.map(([title, gates]) => {
    const shown = gates.filter((t) => !(editing && t === 'Q'));
    if (!shown.length) return '';
    return `<div class="grp"><small>${title}</small>${shown.map((t) => button(`data-t="${t}"`, GATES[t].color, gateLabel(t))).join('')}</div>`;
  });

  const custom = [...defs.values()].filter((d) => !editing || !uses(d.id, editing));
  if (custom.length) {
    groups.push(
      '<div class="grp"><small>Custom</small>' +
        custom.map((d) => button(`data-t="Custom" data-def="${d.id}"`, GATES.Custom.color, escapeHtml(d.name))).join('') +
        '</div>',
    );
  }
  $('#gates').innerHTML = groups.join('');
}

onGatesChanged(renderGatePalette);
