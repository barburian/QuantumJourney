import { defs, type CustomDef } from './custom';
import { $, escapeHtml } from './dom';
import { EXAMPLES, opsToGraph, registerExampleGates, type Example } from './examples';
import { gatesChanged, onGatesChanged } from './gateStore';
import { addNode, alignInput, clearAll, setPosition } from './nodes';
import { refresh } from './render';
import { deleteGate, enterGate, exitAllGates, gateUsage } from './scope';
import { loadGraph, snapshot, type Snapshot } from './snapshot';
import { editor } from './state';
import type { NodeData, Wire } from './types';
import { fitToContent } from './viewport';

const STORAGE_KEY = 'qb-lib';
/** Vertical spacing between qubit lanes in generated layouts. */
const ROW = 110;

interface SavedCircuit {
  name: string;
  g: Snapshot;
  /** The custom gates the circuit uses, including gates nested in them. */
  defs?: CustomDef[];
}

let saved: SavedCircuit[] = [];
try {
  saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
} catch {
  // Storage unavailable or corrupt: start with an empty library.
}

/** The gate whose delete button was pressed and awaits confirmation. */
let confirmingDelete: string | null = null;

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage unavailable: the library just won't survive a reload.
  }
}

/** The definitions used by some blocks, directly or nested. */
function usedDefs(nodes: NodeData[], found = new Map<string, CustomDef>()): Map<string, CustomDef> {
  for (const n of nodes) {
    const def = n.type === 'Custom' && n.def ? defs.get(n.def) : undefined;
    if (!def || found.has(def.id)) continue;
    found.set(def.id, def);
    usedDefs(def.nodes, found);
  }
  return found;
}

/** Replaces the canvas with an example, laid out one qubit per row. */
export function buildExample(example: Example): void {
  exitAllGates();
  clearAll();
  registerExampleGates(example);
  if (example.gates?.length) gatesChanged();
  const graph = opsToGraph(example.qubits, example.ops, example.init, example.links, example.setup);
  const ids = new Map<number, number>();
  let x = 150;

  for (const g of graph.nodes) {
    if (g.type === 'Q') {
      ids.set(g.id, addNode('Q', 20, 20 + g.row * ROW, { init: g.init }).id);
      continue;
    }
    const { p, def, cond, text, vals, goal, steps, rep } = g;
    const node = addNode(g.type, x, 20 + g.row * ROW, { p, def, cond, text, vals, goal, steps, rep });
    // Classical blocks (row −1) sit above the qubits, clear of their wires; gates line up with their first qubit.
    if (g.row >= 0) alignInput(node, 20 + g.row * ROW + 22);
    else {
      node.y = -node.el.offsetHeight - 30;
      setPosition(node);
    }
    ids.set(g.id, node.id);
    x += node.el.offsetWidth + 46;
  }

  const remap = (w: Wire): Wire => ({ a: ids.get(w.a)!, ai: w.ai, b: ids.get(w.b)!, bi: w.bi });
  editor.wires.push(...graph.wires.map(remap));
  editor.cwires.push(...graph.cwires.map(remap));
  fitToContent();
  refresh();
}

function loadSaved(s: SavedCircuit): void {
  exitAllGates();
  for (const d of s.defs ?? []) defs.set(d.id, structuredClone(d));
  if (s.defs?.length) gatesChanged();
  loadGraph(s.g);
  fitToContent();
  refresh();
}

function gateRow(def: CustomDef): string {
  const name = escapeHtml(def.name);
  if (confirmingDelete !== def.id) {
    return (
      `<div class="li" data-g="${def.id}" title="Open to edit"><span>${name}<small>${def.lanes} qubits</small></span>` +
      `<b class="dx" data-gd="${def.id}" title="Delete gate">×</b></div>`
    );
  }
  const { blocks, gates } = gateUsage(def.id);
  const uses = [
    blocks ? `${blocks} block${blocks > 1 ? 's' : ''} on the circuit` : '',
    gates.length ? `copies inside ${gates.map(escapeHtml).join(', ')}` : '',
  ].filter(Boolean);
  return (
    `<div class="li confirm"><span>Delete ${name}?` +
    `<small>${uses.length ? `Also removes ${uses.join(' and ')}.` : 'It isn’t used anywhere.'}</small>` +
    `<span class="acts"><button class="p danger" data-yes="${def.id}">Delete</button>` +
    `<button class="p" data-no>Cancel</button></span></span></div>`
  );
}

export function renderLibrary(): void {
  const examples = EXAMPLES.map(
    (ex, i) => `<div class="li" data-b="${i}"><span>${ex.name}<small>${ex.description}</small></span></div>`,
  ).join('');
  const gates = defs.size
    ? [...defs.values()].map(gateRow).join('')
    : '<p class="mut">No gates yet. Select blocks and press Make gate.</p>';
  const mine = saved.length
    ? saved
        .map(
          (s, i) =>
            `<div class="li" data-s="${i}"><span>${escapeHtml(s.name)}</span>` +
            `<b class="dx" data-d="${i}" title="Delete">×</b></div>`,
        )
        .join('')
    : '<p class="mut">Nothing saved yet. Name the circuit above and press Save.</p>';
  $('#libl').innerHTML = `<h4>Examples</h4>${examples}<h4>My gates</h4>${gates}<h4>My circuits</h4>${mine}`;
}

export function initLibrary(): void {
  onGatesChanged(renderLibrary);

  $('#libl').addEventListener('click', (e) => {
    const target = e.target as Element;
    const el = target.closest<HTMLElement>('[data-yes],[data-no],[data-gd],.dx,.li');
    if (!el) return;
    const { yes, no, gd, d, b, s, g } = el.dataset;

    if (yes) {
      confirmingDelete = null;
      deleteGate(yes);
    } else if (no != null) {
      confirmingDelete = null;
      renderLibrary();
    } else if (gd) {
      confirmingDelete = gd;
      renderLibrary();
    } else if (d != null) {
      saved.splice(Number(d), 1);
      persist();
      renderLibrary();
    } else if (b != null) {
      buildExample(EXAMPLES[Number(b)]);
    } else if (s != null) {
      loadSaved(saved[Number(s)]);
    } else if (g) {
      exitAllGates();
      enterGate(g);
    }
  });

  $('#sv').addEventListener('click', () => {
    exitAllGates();
    const input = $<HTMLInputElement>('#nm');
    const g = snapshot();
    saved.push({
      name: input.value.trim() || `Circuit ${saved.length + 1}`,
      g,
      defs: structuredClone([...usedDefs(g.nodes).values()]),
    });
    persist();
    input.value = '';
    renderLibrary();
  });
}
