import { $, escapeHtml } from './dom';
import { EXAMPLES, opsToGraph, type Example } from './examples';
import { addNode, alignInput, clearAll } from './nodes';
import { refresh } from './render';
import { editor } from './state';
import type { NodeData, Wire } from './types';
import { fitToContent } from './viewport';

const STORAGE_KEY = 'qb-lib';
/** Vertical spacing between qubit lanes in generated layouts. */
const ROW = 110;

export interface Snapshot {
  nodes: Omit<NodeData, 'el'>[];
  wires: Wire[];
}

interface SavedCircuit {
  name: string;
  g: Snapshot;
}

let saved: SavedCircuit[] = [];
try {
  saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
} catch {
  // Storage unavailable or corrupt: start with an empty library.
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage unavailable: the library just won't survive a reload.
  }
}

/** Replaces the canvas with an example, laid out one qubit per row. */
export function buildExample(example: Example): void {
  clearAll();
  const graph = opsToGraph(example.qubits, example.ops, example.init);
  const ids = new Map<number, number>();
  let x = 150;

  for (const g of graph.nodes) {
    if (g.type === 'Q') {
      ids.set(g.id, addNode('Q', 20, 20 + g.row * ROW, { init: g.init }).id);
      continue;
    }
    const node = addNode(g.type, x, 0, { p: g.p });
    alignInput(node, 20 + g.row * ROW + 22);
    ids.set(g.id, node.id);
    x += node.el.offsetWidth + 46;
  }

  for (const w of graph.wires) editor.wires.push({ a: ids.get(w.a)!, ai: w.ai, b: ids.get(w.b)!, bi: w.bi });
  fitToContent();
  refresh();
}

function snapshot(): Snapshot {
  return {
    nodes: editor.nodes.map(({ id, type, x, y, p, init }) => ({ id, type, x, y, p, init })),
    wires: editor.wires.map((w) => ({ ...w })),
  };
}

function loadSnapshot(g: Snapshot): void {
  clearAll();
  const ids = new Map<number, number>();
  for (const s of g.nodes) ids.set(s.id, addNode(s.type, s.x, s.y, { p: s.p, init: s.init }).id);
  for (const w of g.wires) editor.wires.push({ a: ids.get(w.a)!, ai: w.ai, b: ids.get(w.b)!, bi: w.bi });
  fitToContent();
  refresh();
}

export function renderLibrary(): void {
  const examples = EXAMPLES.map(
    (ex, i) => `<div class="li" data-b="${i}"><span>${ex.name}<small>${ex.description}</small></span></div>`,
  ).join('');
  const mine = saved.length
    ? saved
        .map(
          (s, i) =>
            `<div class="li" data-s="${i}"><span>${escapeHtml(s.name)}</span>` +
            `<b class="dx" data-d="${i}" title="Delete">×</b></div>`,
        )
        .join('')
    : '<p class="mut">Nothing saved yet. Name the circuit above and press Save.</p>';
  $('#libl').innerHTML = `<h4>Examples</h4>${examples}<h4>My circuits</h4>${mine}`;
}

export function initLibrary(): void {
  $('#libl').addEventListener('click', (e) => {
    const target = e.target as Element;
    const del = target.closest<HTMLElement>('.dx');
    const item = target.closest<HTMLElement>('.li');
    if (del) {
      saved.splice(Number(del.dataset.d), 1);
      persist();
      renderLibrary();
      return;
    }
    if (!item) return;
    if (item.dataset.b != null) buildExample(EXAMPLES[Number(item.dataset.b)]);
    else loadSnapshot(saved[Number(item.dataset.s)].g);
  });

  $('#sv').addEventListener('click', () => {
    const input = $<HTMLInputElement>('#nm');
    saved.push({ name: input.value.trim() || `Circuit ${saved.length + 1}`, g: snapshot() });
    persist();
    input.value = '';
    renderLibrary();
  });
}
