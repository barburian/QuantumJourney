/* Pointer, keyboard and drag-and-drop handling on the canvas. */
import { link, linkClassical, reaches } from './circuit';
import { defs, pinLabels, repeats } from './custom';
import { $, canvas } from './dom';
import { canBeConditional, isGateType } from './gates';
import { closeExport, exportOpen } from './exportView';
import { closeMatrix, matrixOpen, positionMatrix, toggleMatrix } from './matrixView';
import { optimizerAction } from './optimizerRun';
import {
  chain, insertOnWire, makeConditional, rebuildNode, removeClassicalWire, removeNode, removeNodes, select,
  setPosition, setSelection, toggleSelected,
} from './nodes';
import { refresh } from './render';
import { enterGate, exitGate, groupSelection } from './scope';
import { editor, nodeById } from './state';
import type { CircuitNode, PinRef, Point } from './types';
import { applyView, toWorld, viewport, zoomAt } from './viewport';
import { dragPath, drawWires, pinElement, type PinKind } from './wires';

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
  const pin = target.closest<HTMLElement>('.pin,.cpin');
  if (pin) {
    drag = { kind: 'wire', id: nodeOf(pin)!.id, pin: pin.dataset.k as PinKind, index: Number(pin.dataset.i) };
    e.preventDefault();
    return;
  }
  if (target.closest('.x,.mxb,input,select,textarea,button,#crumb,#mxp,#exp')) return;

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
  if (target.closest('.w,.cw')) return;

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
    editor.pendingWire = dragPath(pinElement(drag.id, drag.pin, drag.index), p);
  }
  drawWires();
}

const OPPOSITE: Record<PinKind, PinKind> = { i: 'o', o: 'i', ci: 'co', co: 'ci' };

/**
 * Finishes a classical wire. Dropped on a matching pin it connects; an output
 * dropped anywhere else on a gate makes that gate conditional on the value.
 * Wiring a measurement's bit switches it to Collapse, since only a collapsed
 * measurement has a bit.
 */
function finishClassical(d: Extract<Drag, { kind: 'wire' }>, target: Element | null): void {
  const pin = target?.closest<HTMLElement>('.cpin');
  const mine: PinRef = [d.id, d.index];
  let from: PinRef | null = null;
  if (pin?.dataset.k === OPPOSITE[d.pin]) {
    const other: PinRef = [nodeOf(pin)!.id, Number(pin.dataset.i)];
    const [out, into] = d.pin === 'co' ? [mine, other] : [other, mine];
    if (linkClassical(out, into)) from = out;
  } else if (d.pin === 'co') {
    const node = nodeOf(target);
    if (node && canBeConditional(node.type) && !reaches(node.id, d.id)) {
      linkClassical(mine, [node.id, makeConditional(node)]);
      from = mine;
    }
  }
  const source = from && nodeById(from[0]);
  if (source?.type === 'M') source.p = 1;
}

function onPointerUp(e: PointerEvent): void {
  if (!drag) return;
  if (drag.kind === 'wire') {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (drag.pin === 'ci' || drag.pin === 'co') {
      finishClassical(drag, target);
    } else {
      const pin = target?.closest<HTMLElement>('.pin');
      if (pin && pin.dataset.k === OPPOSITE[drag.pin]) {
        const mine: PinRef = [drag.id, drag.index];
        const other: PinRef = [nodeOf(pin)!.id, Number(pin.dataset.i)];
        if (drag.pin === 'o') link(mine, other);
        else link(other, mine);
      }
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
  } else if (node?.type === 'Opt' && target.closest('[data-a]')) {
    optimizerAction(node, target.closest<HTMLElement>('[data-a]')!.dataset.a!, refresh, () => rebuildNode(node));
  } else if (target.closest('.cw')) {
    removeClassicalWire(Number(target.closest<SVGGElement>('.cw')!.dataset.c));
    refresh();
  } else {
    const wire = target.closest<SVGGElement>('.w');
    if (wire) {
      editor.wires.splice(Number(wire.dataset.k), 1);
      refresh();
    }
  }
}

/**
 * A Math block's operation or an Optimizer's goal changed. "not" has a single
 * input, so a wire into b is dropped.
 */
function onChange(e: Event): void {
  const select = (e.target as Element).closest<HTMLSelectElement>('select');
  const node = nodeOf(select);
  if (!select || !node) return;
  if (select.classList.contains('goal')) {
    node.goal = select.value === 'max' ? 'max' : 'min';
    refresh();
    return;
  }
  node.op = select.value;
  if (node.op === 'not') editor.cwires = editor.cwires.filter((w) => !(w.b === node.id && w.bi === 1));
  rebuildNode(node);
  refresh();
}

function onDoubleClick(e: MouseEvent): void {
  const target = e.target as Element;
  if (target.closest('button,input,select,textarea,.pin,.cpin,.x,.mxb')) return;
  const node = nodeOf(target);
  if (node?.type === 'Custom' && node.def) enterGate(node.def);
}

/**
 * Typing in a block: an Expectation's Hamiltonian, an Optimizer's step limit,
 * or a number (angle, Number value, learning rate), which all live in `p`.
 */
function onInput(e: Event): void {
  const field = e.target as HTMLInputElement | HTMLTextAreaElement;
  const node = nodeOf(field);
  if (!node || !['INPUT', 'TEXTAREA'].includes(field.tagName)) return;
  if (field.classList.contains('ht')) node.text = field.value;
  else if (field.classList.contains('steps')) node.steps = Math.max(1, Math.round(parseFloat(field.value) || 1));
  else if (field.classList.contains('rep')) node.rep = repeats({ rep: parseFloat(field.value) });
  else node.p = parseFloat(field.value) || 0;
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
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selection.size) {
    removeNodes([...editor.selection]);
  } else if (e.key.toLowerCase() === 'g' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    groupSelection();
  } else if (e.key === 'Escape' && matrixOpen()) {
    closeMatrix();
  } else if (e.key === 'Escape' && exportOpen()) {
    closeExport();
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
  canvas.addEventListener('change', onChange);
  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', onDrop);
  canvas.addEventListener(
    'wheel',
    (e) => {
      // The matrix and export panels scroll normally.
      if ((e.target as Element).closest('#mxp,#exp')) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false },
  );
  addEventListener('keydown', onKeyDown);
  addEventListener('resize', drawWires);
}
