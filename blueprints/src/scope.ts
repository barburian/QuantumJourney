/* Making, editing and deleting custom gates. */
import { link } from './circuit';
import { defs, groupNodes } from './custom';
import { $, notify } from './dom';
import { gatesChanged } from './gateStore';
import { addNode, removeNodes, select, setSelection } from './nodes';
import { renderGatePalette } from './palette';
import { refresh } from './render';
import { loadGraph, snapshot } from './snapshot';
import { editor } from './state';
import { applyView, centerOf, fitToContent, viewport } from './viewport';
import { pinElement } from './wires';

/** "Gate n" with the smallest n not already taken. */
function freshGateName(): string {
  const names = new Set([...defs.values()].map((d) => d.name));
  let n = 1;
  while (names.has(`Gate ${n}`)) n++;
  return `Gate ${n}`;
}

/** Collapses the selected blocks into a new custom gate block, keeping their outside wires. */
export function groupSelection(): void {
  const selected = [...editor.selection];
  const grouping = groupNodes(
    selected,
    editor.wires,
    freshGateName(),
    (node, pin) => centerOf(pinElement(node.id, 'i', pin))[1],
    editor.cwires,
  );
  if (!grouping) return;
  const { def, sources, targets, cut } = grouping;
  if (!def.lanes) {
    notify('A gate needs at least one qubit passing through it.');
    return;
  }
  if (cut) {
    notify(
      `Can’t make a gate: ${cut} classical wire${cut > 1 ? 's' : ''} would cross its edge. ` +
        'Include the Number/Math blocks they come from, or remove those wires.',
    );
    return;
  }
  defs.set(def.id, def);

  const members = new Set(def.nodes.map((n) => n.id));
  const moved = selected.filter((n) => members.has(n.id));
  const x = Math.min(...moved.map((n) => n.x));
  const y = Math.min(...moved.map((n) => n.y));
  removeNodes(moved);

  const block = addNode('Custom', x, y, { def: def.id });
  sources.forEach((src, k) => src && link(src, [block.id, k]));
  targets.forEach((dst, k) => dst && link([block.id, k], dst));
  select(block);
  editor.last = block;
  gatesChanged();
  refresh();
}

function renderCrumb(): void {
  const crumb = $('#crumb');
  const scope = editor.scopes.at(-1);
  crumb.hidden = !scope;
  if (!scope) return;
  const path = ['Main', ...editor.scopes.slice(0, -1).map((s) => defs.get(s.defId)?.name ?? '?')];
  $('#path').textContent = `${path.join(' › ')} ›`;
  $<HTMLInputElement>('#gname').value = defs.get(scope.defId)?.name ?? '';
}

function showScope(): void {
  renderCrumb();
  renderGatePalette();
  refresh();
}

/** Opens a custom gate's subcircuit for editing, from wherever the editor is. */
export function enterGate(defId: string): void {
  const def = defs.get(defId);
  if (!def) return;
  editor.scopes.push({ defId: def.id, parent: { ...snapshot(), view: { ...viewport } } });
  loadGraph(def);
  fitToContent();
  showScope();
}

/** Saves the gate being edited and returns to the circuit that uses it. */
export function exitGate(): void {
  const scope = editor.scopes.pop();
  if (!scope) return;
  const def = defs.get(scope.defId);
  if (def) Object.assign(def, snapshot());
  loadGraph(scope.parent);
  Object.assign(viewport, scope.parent.view);
  applyView();
  setSelection([]);
  showScope();
  gatesChanged();
}

/** Returns to the main circuit, saving every gate being edited. */
export function exitAllGates(): void {
  while (editor.scopes.length) exitGate();
}

/** Where a gate is used: blocks on the main circuit, and other gates containing it. */
export function gateUsage(defId: string): { blocks: number; gates: string[] } {
  const isCopy = (n: { type: string; def?: string }) => n.type === 'Custom' && n.def === defId;
  const main = editor.scopes[0]?.parent.nodes ?? editor.nodes;
  return {
    blocks: main.filter(isCopy).length,
    gates: [...defs.values()].filter((d) => d.id !== defId && d.nodes.some(isCopy)).map((d) => d.name),
  };
}

/** Deletes a gate, along with its blocks on the main circuit and inside other gates. */
export function deleteGate(defId: string): void {
  exitAllGates();
  removeNodes(editor.nodes.filter((n) => n.type === 'Custom' && n.def === defId));
  for (const d of defs.values()) {
    const gone = new Set(d.nodes.filter((n) => n.type === 'Custom' && n.def === defId).map((n) => n.id));
    if (!gone.size) continue;
    d.nodes = d.nodes.filter((n) => !gone.has(n.id));
    d.wires = d.wires.filter((w) => !gone.has(w.a) && !gone.has(w.b));
  }
  defs.delete(defId);
  gatesChanged();
  refresh();
}

export function initScope(): void {
  $('#back').addEventListener('click', exitGate);
  $<HTMLInputElement>('#gname').addEventListener('input', (e) => {
    const scope = editor.scopes.at(-1);
    const def = scope && defs.get(scope.defId);
    const name = (e.target as HTMLInputElement).value.trim();
    if (def && name) {
      def.name = name;
      gatesChanged();
    }
  });
  // Edits inside a gate are saved when leaving it, so leave before the page goes.
  addEventListener('pagehide', () => {
    if (editor.scopes.length) exitAllGates();
  });
}
