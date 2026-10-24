import { freeOutput, link, sourceQubit } from './circuit';
import { world } from './dom';
import { GATES } from './gates';
import { refresh } from './render';
import { editor } from './state';
import type { CircuitNode, GateDef, GateType, NodeData } from './types';
import { centerOf } from './viewport';
import { pinElement } from './wires';

/** Horizontal gap between a block and the one chained after it. */
const CHAIN_GAP = 44;
/** Vertical spacing between qubits added from the toolbar. */
const QUBIT_SPACING = 110;

function nodeHtml(node: NodeData, def: GateDef): string {
  const pinIn = (i: number) => `<i class="pin" data-k="i" data-i="${i}"></i>`;
  const pinOut = (i: number) => `<i class="pin" data-k="o" data-i="${i}"></i>`;
  const bg = `style="background:${def.color}"`;

  if (def.kind === 'sq') return `<div class="hd tile" ${bg}>${pinIn(0)}<b class="tt"></b>${pinOut(0)}</div>`;
  if (def.kind === 'rot') {
    return (
      `<div class="hd tile" ${bg}>${pinIn(0)}<b class="tt"></b>` +
      `<input type="number" step="0.25" value="${node.p}" aria-label="Angle in multiples of pi"><small>π</small>` +
      `${pinOut(0)}</div>`
    );
  }
  if (def.kind === 'q') {
    return (
      `<div class="hd tile" ${bg}><b class="tt"></b>` +
      `<button class="st" title="Click to change the initial state"></button>${pinOut(0)}</div>`
    );
  }

  let html = `<div class="hd" ${bg}><span class="tt"></span></div>`;
  for (let i = 0; i < Math.max(def.ins.length, def.outs.length); i++) {
    html +=
      `<div class="rw">${i < def.ins.length ? pinIn(i) : '<i class="sp"></i>'}` +
      `<span>${def.ins[i] || def.outs[i] || ''}</span>` +
      `${i < def.outs.length ? pinOut(i) : '<i class="sp"></i>'}</div>`;
  }
  if (def.param) html += `<label class="pr">θ/π<input type="number" step="0.25" value="${node.p}"></label>`;
  if (def.measure) {
    html +=
      '<div class="mx"><span class="bar"><i></i></span><span class="m"></span>' +
      '<button class="md" title="Peek reads the state; Collapse measures it"></button></div>';
  }
  return html;
}

export function setPosition(node: CircuitNode): void {
  node.el.style.left = `${node.x}px`;
  node.el.style.top = `${node.y}px`;
}

export function select(node: CircuitNode | null): void {
  editor.selected = node;
  for (const n of editor.nodes) n.el.classList.toggle('sel', n === node);
}

export function addNode(type: GateType, x: number, y: number, opts: { p?: number; init?: number } = {}): CircuitNode {
  const def = GATES[type];
  const el = document.createElement('div');
  const node: CircuitNode = {
    id: ++editor.lastId,
    type,
    x,
    y,
    p: opts.p ?? (def.param ? 0.5 : 0),
    init: opts.init || 0,
    el,
  };
  el.className = `node ${def.kind === 'full' ? 'full' : `t ${def.kind}`}`;
  el.dataset.id = String(node.id);
  el.innerHTML = nodeHtml(node, def) + '<b class="x" title="Delete">×</b>';
  world.appendChild(el);
  setPosition(node);
  editor.nodes.push(node);
  return node;
}

export function removeNode(node: CircuitNode): void {
  node.el.remove();
  editor.nodes = editor.nodes.filter((n) => n !== node);
  editor.wires = editor.wires.filter((w) => w.a !== node.id && w.b !== node.id);
  if (editor.selected === node) editor.selected = null;
  if (editor.last === node) editor.last = null;
  refresh();
}

export function clearAll(): void {
  for (const n of editor.nodes) n.el.remove();
  editor.nodes = [];
  editor.wires = [];
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
 * Adds a gate from the toolbar. Without a drop position it goes to the right
 * of the selected (or last added) block; with auto-connect on it is wired to
 * that block's first free output, and extra inputs of multi-qubit gates are
 * wired to the most recent free outputs carrying other qubits.
 */
export function chain(type: GateType, x?: number, y?: number): void {
  const def = GATES[type];
  const prev = editor.selected || editor.last;
  const pin = editor.autoConnect && prev && def.ins.length ? freeOutput(prev) : -1;
  let node: CircuitNode;

  if (type === 'Q') {
    const ys = editor.nodes.filter((m) => m.type === 'Q').map((m) => m.y);
    node = addNode(type, x ?? 24, y ?? (ys.length ? Math.max(...ys) + QUBIT_SPACING : 24));
  } else if (x != null && y != null) {
    node = addNode(type, x, y);
  } else if (prev && pin >= 0) {
    node = addNode(type, prev.x + prev.el.offsetWidth + CHAIN_GAP, 0);
    alignInput(node, centerOf(pinElement(prev.id, 'o', pin))[1]);
  } else {
    node = addNode(type, prev ? prev.x + prev.el.offsetWidth + CHAIN_GAP : 60, prev ? prev.y : 40);
  }
  avoidOverlap(node);

  if (prev && pin >= 0) {
    link([prev.id, pin], [node.id, 0]);
    const mine = sourceQubit(prev.id, pin);
    for (let k = 1; k < def.ins.length; k++) {
      const other = editor.nodes
        .slice()
        .reverse()
        .find((c) => {
          if (c === node || c === prev) return false;
          const out = freeOutput(c);
          if (out < 0) return false;
          const q = sourceQubit(c.id, out);
          return q != null && q !== mine;
        });
      if (other) link([other.id, freeOutput(other)], [node.id, k]);
    }
  }

  select(node);
  editor.last = node;
  refresh();
}
