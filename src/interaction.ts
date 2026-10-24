/* Pointer, keyboard and drag-and-drop handling on the canvas. */
import { link } from './circuit';
import { canvas } from './dom';
import { isGateType } from './gates';
import { chain, removeNode, select, setPosition } from './nodes';
import { refresh } from './render';
import { editor, nodeById } from './state';
import type { CircuitNode, PinRef } from './types';
import { applyView, centerOf, toWorld, viewport, zoomAt } from './viewport';
import { drawWires, pinElement, wirePath, type PinKind } from './wires';

type Drag =
  | { kind: 'wire'; id: number; pin: PinKind; index: number }
  | { kind: 'node'; node: CircuitNode; dx: number; dy: number }
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number };

let drag: Drag | null = null;

const nodeOf = (el: Element | null): CircuitNode | undefined => {
  const nodeEl = el?.closest<HTMLElement>('.node');
  return nodeEl ? nodeById(Number(nodeEl.dataset.id)) : undefined;
};

function onPointerDown(e: PointerEvent): void {
  const target = e.target as Element;
  const pin = target.closest<HTMLElement>('.pin');
  if (pin) {
    drag = { kind: 'wire', id: nodeOf(pin)!.id, pin: pin.dataset.k as PinKind, index: Number(pin.dataset.i) };
    e.preventDefault();
    return;
  }
  if (target.closest('.x,input,button')) return;

  const node = nodeOf(target);
  if (node) {
    select(node);
    if (target.closest('.hd')) {
      const [px, py] = toWorld(e);
      drag = { kind: 'node', node, dx: px - node.x, dy: py - node.y };
    }
    return;
  }
  if (target.closest('.w')) return;

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
  if (drag.kind === 'node') {
    drag.node.x = Math.max(0, p[0] - drag.dx);
    drag.node.y = Math.max(0, p[1] - drag.dy);
    setPosition(drag.node);
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
  }
  drag = null;
  editor.pendingWire = '';
  refresh();
}

function onClick(e: MouseEvent): void {
  const target = e.target as Element;
  const node = nodeOf(target);
  if (node && target.closest('.x')) {
    removeNode(node);
  } else if (node && target.closest('.st')) {
    node.init = ((node.init || 0) + 1) % 4;
    refresh();
  } else if (node && target.closest('.md')) {
    node.p = node.p ? 0 : 1;
    refresh();
  } else {
    const wire = target.closest<SVGGElement>('.w');
    if (wire) {
      editor.wires.splice(Number(wire.dataset.k), 1);
      refresh();
    }
  }
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
  const t = e.dataTransfer?.getData('text/plain') ?? '';
  if (!isGateType(t)) return;
  const [x, y] = toWorld(e);
  chain(t, Math.max(0, x - 30), Math.max(0, y - 22));
}

export function initInteraction(): void {
  canvas.addEventListener('pointerdown', onPointerDown);
  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('input', onInput);
  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', onDrop);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false },
  );
  addEventListener('keydown', (e) => {
    const typing = document.activeElement?.tagName === 'INPUT';
    if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selected && !typing) removeNode(editor.selected);
  });
  addEventListener('resize', drawWires);
}
