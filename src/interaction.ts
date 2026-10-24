/* Pointer, keyboard and drag-and-drop handling on the canvas. */
import { link } from './circuit';
import { defs, pinLabels } from './custom';
import { $, canvas } from './dom';
import { isGateType } from './gates';
import { closeMatrix, matrixOpen, positionMatrix, toggleMatrix } from './matrixView';
import {
  chain, insertOnWire, rebuildNode, removeNode, removeNodes, select, setPosition, setSelection, toggleSelected,
} from './nodes';
import { refresh } from './render';
import { enterGate, exitGate, groupSelection } from './scope';
import { editor, nodeById } from './state';
import type { CircuitNode, PinRef, Point } from './types';
import { applyView, centerOf, toWorld, viewport, zoomAt } from './viewport';
import { drawWires, pinElement, wirePath, type PinKind } from './wires';

type Drag =
  | { kind: 'wire'; id: number; pin: PinKind; index: number }
  | { kind: 'nodes'; items: { node: CircuitNode; dx: number; dy: number }[] }
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'box'; start: Point; end: Point };

let drag: Drag | null = null;

const nodeOf = (el: Element | null): CircuitNode | undefined => {
  const nodeEl = el?.closest<HTMLElement>('.node');
  return nodeEl ? nodeById(Number(nodeEl.dataset.id)) : undefined;
};

/** Selection rectangle in world coordinates: [left, top, right, bottom]. */
function boxRect(d: Extract<Drag, { kind: 'box' }>): [number, number, number, number] {
  const [x0, y0] = d.start, [x1, y1] = d.end;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

function drawBox(d: Extract<Drag, { kind: 'box' }> | null): void {
  const box = $('#box');
  box.hidden = !d;
  if (!d) return;
  const [l, t, r, b] = boxRect(d);
  Object.assign(box.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
}

function onPointerDown(e: PointerEvent): void {
  const target = e.target as Element;
  const pin = target.closest<HTMLElement>('.pin');
  if (pin) {
    drag = { kind: 'wire', id: nodeOf(pin)!.id, pin: pin.dataset.k as PinKind, index: Number(pin.dataset.i) };
    e.preventDefault();
    return;
  }
  if (target.closest('.x,.mxb,input,button,#crumb,#mxp')) return;

  const node = nodeOf(target);
  if (node) {
    if (e.shiftKey) {
      toggleSelected(node);
      return;
    }
    if (!editor.selection.has(node)) select(node);
    if (target.closest('.hd')) {
      // Dragging a selected block moves the whole selection.
      const [px, py] = toWorld(e);
      drag = { kind: 'nodes', items: [...editor.selection].map((n) => ({ node: n, dx: px - n.x, dy: py - n.y })) };
    }
    return;
  }
  if (target.closest('.w')) return;

  if (e.shiftKey) {
    const p = toWorld(e);
    drag = { kind: 'box', start: p, end: p };
    return;
  }
  select(null);
  drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, originX: viewport.x, originY: viewport.y };
}

function onPointerMove(e: PointerEvent): void {
  if (!drag) return;
  if (drag.kind === 'pan') {
    viewport.x = drag.originX + e.clientX - drag.startX;
    viewport.y = drag.originY + e.clientY - drag.startY;
    applyView();
    return;
  }

  const p = toWorld(e);
  if (drag.kind === 'box') {
    drag.end = p;
    drawBox(drag);
    return;
  }
  if (drag.kind === 'nodes') {
    for (const { node, dx, dy } of drag.items) {
      node.x = Math.max(0, p[0] - dx);
      node.y = Math.max(0, p[1] - dy);
      setPosition(node);
    }
    positionMatrix();
  } else {
    const anchor = centerOf(pinElement(drag.id, drag.pin, drag.index));
    editor.pendingWire = drag.pin === 'o' ? wirePath(anchor, p) : wirePath(p, anchor);
  }
  drawWires();
}

function onPointerUp(e: PointerEvent): void {
  if (!drag) return;
  if (drag.kind === 'wire') {
    const pin = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.pin');
    if (pin && pin.dataset.k !== drag.pin) {
      const mine: PinRef = [drag.id, drag.index];
      const other: PinRef = [nodeOf(pin)!.id, Number(pin.dataset.i)];
      if (drag.pin === 'o') link(mine, other);
      else link(other, mine);
    }
  } else if (drag.kind === 'box') {
    const [l, t, r, b] = boxRect(drag);
    const inside = editor.nodes.filter(
      (n) => n.x < r && n.x + n.el.offsetWidth > l && n.y < b && n.y + n.el.offsetHeight > t,
    );
    setSelection([...new Set([...editor.selection, ...inside])]);
    drawBox(null);
  }
  drag = null;
  editor.pendingWire = '';
  refresh();
}

/** Turns a custom block's control pin on or off; turning it off drops the control wires. */
function toggleControl(node: CircuitNode): void {
  if (node.ctrl) {
    const pin = pinLabels(node).ins.length - 1;
    editor.wires = editor.wires.filter((w) => !(w.b === node.id && w.bi === pin) && !(w.a === node.id && w.ai === pin));
  }
  node.ctrl = !node.ctrl;
  rebuildNode(node);
  refresh();
}

function onClick(e: MouseEvent): void {
  const target = e.target as Element;
  const node = nodeOf(target);
  if (node && target.closest('.x')) {
    removeNode(node);
  } else if (node && target.closest('.mxb')) {
    toggleMatrix(node.id);
  } else if (node && target.closest('.st')) {
    node.init = ((node.init || 0) + 1) % 4;
    refresh();
  } else if (node && target.closest('.md')) {
    node.p = node.p ? 0 : 1;
    refresh();
  } else if (node && target.closest('.dg')) {
    node.dagger = !node.dagger;
    refresh();
  } else if (node && target.closest('.cg')) {
    toggleControl(node);
  } else {
    const wire = target.closest<SVGGElement>('.w');
    if (wire) {
      editor.wires.splice(Number(wire.dataset.k), 1);
      refresh();
    }
  }
}

function onDoubleClick(e: MouseEvent): void {
  const target = e.target as Element;
  if (target.closest('button,input,.pin,.x,.mxb')) return;
  const node = nodeOf(target);
  if (node?.type === 'Custom' && node.def) enterGate(node.def);
}

function onInput(e: Event): void {
  const input = (e.target as Element).closest('input');
  const node = nodeOf(input);
  if (!input || !node) return;
  node.p = parseFloat(input.value) || 0;
  refresh();
}

function onDrop(e: DragEvent): void {
  e.preventDefault();
  const payload = e.dataTransfer?.getData('text/plain') ?? '';
  const [t, def] = payload.split(':');
  if (!isGateType(t) || (t === 'Custom' && !defs.has(def))) return;
  const opts = def ? { def } : {};
  const [x, y] = toWorld(e);
  // Single-qubit blocks dropped on a wire are spliced into it.
  const wire = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGGElement>('.w');
  const { ins, outs } = pinLabels({ type: t, def });
  if (wire && ins.length === 1 && outs.length === 1) {
    insertOnWire(t, Number(wire.dataset.k), [Math.max(0, x - 30), y], opts);
    return;
  }
  chain(t, Math.max(0, x - 30), Math.max(0, y - 22), opts);
}

function onKeyDown(e: KeyboardEvent): void {
  if (document.activeElement?.tagName === 'INPUT') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selection.size) {
    removeNodes([...editor.selection]);
  } else if (e.key.toLowerCase() === 'g' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    groupSelection();
  } else if (e.key === 'Escape' && matrixOpen()) {
    closeMatrix();
  } else if (e.key === 'Escape' && editor.scopes.length) {
    exitGate();
  }
}

export function initInteraction(): void {
  canvas.addEventListener('pointerdown', onPointerDown);
  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('input', onInput);
  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', onDrop);
  canvas.addEventListener(
    'wheel',
    (e) => {
      // The matrix panel scrolls normally.
      if ((e.target as Element).closest('#mxp')) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false },
  );
  addEventListener('keydown', onKeyDown);
  addEventListener('resize', drawWires);
}
