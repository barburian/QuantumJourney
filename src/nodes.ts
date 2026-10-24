import { freeOutput, link, sourceQubit } from './circuit';
import { pinLabels } from './custom';
import { escapeHtml, world } from './dom';
import { GATES } from './gates';
import { hasMatrix } from './matrix';
import { refresh } from './render';
import { editor } from './state';
import type { CircuitNode, GateType, NodeData, Point } from './types';
import { centerOf } from './viewport';
import { pinElement } from './wires';

/** Horizontal gap between a block and the one chained after it. */
const CHAIN_GAP = 44;
/** Vertical spacing between qubits added from the toolbar. */
const QUBIT_SPACING = 110;

export type NodeOptions = Partial<Pick<NodeData, 'p' | 'init' | 'def' | 'dagger' | 'ctrl'>>;

function nodeHtml(node: NodeData): string {
  const gate = GATES[node.type];
  const { ins, outs } = pinLabels(node);
  const pinIn = (i: number) => `<i class="pin" data-k="i" data-i="${i}"></i>`;
  const pinOut = (i: number) => `<i class="pin" data-k="o" data-i="${i}"></i>`;
  const bg = `style="background:${gate.color}"`;

  if (gate.kind === 'sq') return `<div class="hd tile" ${bg}>${pinIn(0)}<b class="tt"></b>${pinOut(0)}</div>`;
  if (gate.kind === 'rot') {
    return (
      `<div class="hd tile" ${bg}>${pinIn(0)}<b class="tt"></b>` +
      `<input type="number" step="0.25" value="${node.p}" aria-label="Angle in multiples of pi"><small>π</small>` +
      `${pinOut(0)}</div>`
    );
  }
  if (gate.kind === 'q') {
    return (
      `<div class="hd tile" ${bg}><b class="tt"></b>` +
      `<button class="st" title="Click to change the initial state"></button>${pinOut(0)}</div>`
    );
  }

  let html = `<div class="hd" ${bg}><span class="tt"></span>`;
  if (node.type === 'Custom') {
    html +=
      '<span class="ops"><button class="dg" title="Inverse (dagger)">†</button>' +
      '<button class="cg" title="Controlled: adds a control qubit">C</button></span>';
  }
  html += '</div>';

  // A custom gate's control pin is last, but shown on top.
  const rows = Array.from({ length: Math.max(ins.length, outs.length) }, (_, i) => i);
  if (node.type === 'Custom' && node.ctrl) rows.unshift(rows.pop()!);
  for (const i of rows) {
    html +=
      `<div class="rw">${i < ins.length ? pinIn(i) : '<i class="sp"></i>'}` +
      `<span>${escapeHtml(ins[i] || outs[i] || '')}</span>` +
      `${i < outs.length ? pinOut(i) : '<i class="sp"></i>'}</div>`;
  }
  if (gate.param) html += `<label class="pr">θ/π<input type="number" step="0.25" value="${node.p}"></label>`;
  if (gate.measure) {
    html +=
      '<div class="mx"><span class="bar"><i></i></span><span class="m"></span>' +
      '<button class="md" title="Peek reads the state; Collapse measures it"></button></div>';
  }
  if (gate.probe) {
    html +=
      '<div class="pb"><svg class="bloch" viewBox="-60 -60 120 120"></svg><span class="pv"></span>' +
      '<div class="amps"></div><span class="pa"></span></div>';
  }
  return html;
}

/** Redraws a block's contents, e.g. after its pins changed. */
export function rebuildNode(node: CircuitNode): void {
  const matrixButton = hasMatrix(node) ? '<b class="mxb" title="Show matrix">⊞</b>' : '';
  node.el.innerHTML = nodeHtml(node) + matrixButton + '<b class="x" title="Delete">×</b>';
}

export function setPosition(node: CircuitNode): void {
  node.el.style.left = `${node.x}px`;
  node.el.style.top = `${node.y}px`;
}

function markSelection(): void {
  for (const n of editor.nodes) n.el.classList.toggle('sel', editor.selection.has(n));
}

/** Selects a single block, or nothing. */
export function select(node: CircuitNode | null): void {
  setSelection(node ? [node] : []);
}

export function setSelection(nodes: CircuitNode[]): void {
  editor.selection = new Set(nodes);
  editor.selected = nodes.at(-1) ?? null;
  markSelection();
}

export function toggleSelected(node: CircuitNode): void {
  const nodes = [...editor.selection];
  setSelection(editor.selection.has(node) ? nodes.filter((n) => n !== node) : [...nodes, node]);
}

export function addNode(type: GateType, x: number, y: number, opts: NodeOptions = {}): CircuitNode {
  const gate = GATES[type];
  const el = document.createElement('div');
  const node: CircuitNode = {
    id: ++editor.lastId,
    type,
    x,
    y,
    p: opts.p ?? (gate.param ? 0.5 : 0),
    init: opts.init || 0,
    el,
  };
  if (opts.def) node.def = opts.def;
  if (opts.dagger) node.dagger = true;
  if (opts.ctrl) node.ctrl = true;

  const kind = gate.kind === 'full' ? 'full' : `t ${gate.kind}`;
  const extra = gate.probe ? ' probe' : type === 'Custom' ? ' custom' : type === 'In' || type === 'Out' ? ' io' : '';
  el.className = `node ${kind}${extra}`;
  el.dataset.id = String(node.id);
  world.appendChild(el);
  rebuildNode(node);
  setPosition(node);
  editor.nodes.push(node);
  return node;
}

/** Removes blocks and their wires. The In and Out blocks of a custom gate can't be removed. */
export function removeNodes(nodes: Iterable<CircuitNode>): void {
  const gone = new Set([...nodes].filter((n) => n.type !== 'In' && n.type !== 'Out'));
  if (!gone.size) return;
  for (const n of gone) n.el.remove();
  editor.nodes = editor.nodes.filter((n) => !gone.has(n));
  editor.wires = editor.wires.filter((w) => editor.nodes.some((n) => n.id === w.a) && editor.nodes.some((n) => n.id === w.b));
  setSelection([...editor.selection].filter((n) => !gone.has(n)));
  if (editor.last && gone.has(editor.last)) editor.last = null;
  refresh();
}

export function removeNode(node: CircuitNode): void {
  removeNodes([node]);
}

export function clearAll(): void {
  for (const n of editor.nodes) n.el.remove();
  editor.nodes = [];
  editor.wires = [];
  editor.selection = new Set();
  editor.selected = editor.last = null;
}

/** Moves a block vertically so that its first input pin sits at world y = `pinY`. */
export function alignInput(node: CircuitNode, pinY: number): void {
  const offset = centerOf(pinElement(node.id, 'i', 0))[1] - node.y;
  node.y = pinY - offset;
  setPosition(node);
}

/** Pushes a block down until it no longer overlaps another one. */
function avoidOverlap(node: CircuitNode): void {
  const MARGIN = 8;
  for (let attempt = 0; attempt < 40; attempt++) {
    const overlaps = editor.nodes.some(
      (m) =>
        m !== node &&
        node.x < m.x + m.el.offsetWidth + MARGIN &&
        m.x < node.x + node.el.offsetWidth + MARGIN &&
        node.y < m.y + m.el.offsetHeight + MARGIN &&
        m.y < node.y + node.el.offsetHeight + MARGIN,
    );
    if (!overlaps) break;
    node.y += node.el.offsetHeight + 18;
    setPosition(node);
  }
}

/**
 * Splits wire `index` with a new single-qubit block. With `at` (world
 * coordinates) the block's input sits there; otherwise it goes between the
 * wire's ends. Either way it is moved down if it overlaps something.
 */
export function insertOnWire(type: GateType, index: number, at?: Point, opts: NodeOptions = {}): void {
  const w = editor.wires[index];
  let node: CircuitNode;
  if (at) {
    node = addNode(type, at[0], 0, opts);
    alignInput(node, at[1]);
  } else {
    const a = centerOf(pinElement(w.a, 'o', w.ai));
    const b = centerOf(pinElement(w.b, 'i', w.bi));
    node = addNode(type, 0, 0, opts);
    node.x = Math.max(0, (a[0] + b[0]) / 2 - node.el.offsetWidth / 2);
    alignInput(node, (a[1] + b[1]) / 2);
  }
  avoidOverlap(node);
  editor.wires.splice(index, 1, { a: w.a, ai: w.ai, b: node.id, bi: 0 }, { a: node.id, ai: 0, b: w.b, bi: w.bi });
  select(node);
  editor.last = node;
  refresh();
}

/**
 * Adds a gate from the toolbar. Without a drop position it goes to the right
 * of the selected (or last added) block; with auto-connect on it is wired to
 * that block's first free output, and extra inputs of multi-qubit gates are
 * wired to the most recent free outputs carrying other qubits (for custom
 * gates, the previous block's outputs come first). A probe on a
 * block whose outputs are all wired is inserted into its first outgoing wire.
 */
export function chain(type: GateType, x?: number, y?: number, opts: NodeOptions = {}): void {
  const gate = GATES[type];
  const ins = pinLabels({ type, def: opts.def }).ins;
  const prev = editor.selected || editor.last;
  const pin = editor.autoConnect && prev && ins.length ? freeOutput(prev) : -1;
  let node: CircuitNode;

  if (gate.probe && x == null && editor.autoConnect && prev && pin < 0) {
    const wire = editor.wires.findIndex((w) => w.a === prev.id);
    if (wire >= 0) return insertOnWire(type, wire);
  }

  if (type === 'Q') {
    const ys = editor.nodes.filter((m) => m.type === 'Q').map((m) => m.y);
    node = addNode(type, x ?? 24, y ?? (ys.length ? Math.max(...ys) + QUBIT_SPACING : 24), opts);
  } else if (x != null && y != null) {
    node = addNode(type, x, y, opts);
  } else if (prev && pin >= 0) {
    node = addNode(type, prev.x + prev.el.offsetWidth + CHAIN_GAP, 0, opts);
    alignInput(node, centerOf(pinElement(prev.id, 'o', pin))[1]);
  } else {
    node = addNode(type, prev ? prev.x + prev.el.offsetWidth + CHAIN_GAP : 60, prev ? prev.y : 40, opts);
  }
  avoidOverlap(node);

  if (prev && pin >= 0) {
    link([prev.id, pin], [node.id, 0]);
    const used = new Set([sourceQubit(prev.id, pin)]);
    // Custom gates take the rest of their lanes from the previous block first.
    const pool = editor.nodes.slice().reverse().filter((c) => c !== node && c !== prev);
    if (type === 'Custom') pool.unshift(prev);
    for (let k = 1; k < ins.length; k++) {
      const other = pool.find((c) => {
        const out = freeOutput(c);
        if (out < 0) return false;
        const q = sourceQubit(c.id, out);
        return q != null && !used.has(q);
      });
      if (other) {
        const out = freeOutput(other);
        used.add(sourceQubit(other.id, out));
        link([other.id, out], [node.id, k]);
      }
    }
  }

  select(node);
  editor.last = node;
  refresh();
}
