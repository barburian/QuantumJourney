/* The matrix panel opened from a block's ⊞ button. */
import { nodeTitle, pinLabels } from './custom';
import { $, canvas, escapeHtml } from './dom';
import { blockMatrix, formatComplex, hasMatrix, reverseQubitOrder, type Complex } from './matrix';
import { phaseColor } from './phase';
import { editor, nodeById } from './state';
import { viewListeners } from './viewport';

const ORDER_KEY = 'qb-matrix-order';
/** Above this many qubits the matrix is shown as colours only; above MAX_QUBITS not at all. */
const TEXT_QUBITS = 4;
const MAX_QUBITS = 6;

let openId: number | null = null;
/** Textbook order: pin 0 is the most significant (leftmost) bit, as in most textbooks. */
let textbook = false;
try {
  textbook = localStorage.getItem(ORDER_KEY) === 'textbook';
} catch {
  // Storage unavailable: use the default order.
}

export const matrixOpen = (): boolean => openId != null;

/** Opens the panel for a block, or closes it if it's already showing that block. */
export function toggleMatrix(id: number): void {
  openId = openId === id ? null : id;
  renderMatrix();
}

export function closeMatrix(): void {
  openId = null;
  renderMatrix();
}

function cell(z: Complex, r: string, c: string, showText: boolean): string {
  const mag = Math.hypot(z.re, z.im);
  const text = formatComplex(z);
  const bg = mag < 1e-6
    ? 'transparent'
    : `color-mix(in srgb, ${phaseColor(Math.atan2(z.im, z.re))} ${Math.round(15 + 55 * Math.min(1, mag))}%, transparent)`;
  return `<td class="${mag < 1e-6 ? 'z' : ''}" style="--c:${bg}" title="⟨${r}|U|${c}⟩ = ${text}">${showText ? text : ''}</td>`;
}

function table(m: Complex[][], bits: number): string {
  const label = (i: number) => i.toString(2).padStart(bits, '0');
  const showText = bits <= TEXT_QUBITS;
  const head = `<tr><th></th>${m.map((_, c) => `<th>|${label(c)}⟩</th>`).join('')}</tr>`;
  const rows = m
    .map((row, r) => `<tr><th>⟨${label(r)}|</th>${row.map((z, c) => cell(z, label(r), label(c), showText)).join('')}</tr>`)
    .join('');
  return `<div class="mtw"><table class="mt${bits >= 3 ? ' small' : ''}${showText ? '' : ' heat'}">${head}${rows}</table></div>`;
}

/** Puts the panel beside its block, inside the canvas. */
export function positionMatrix(): void {
  const panel = $('#mxp');
  const node = openId != null ? nodeById(openId) : undefined;
  if (panel.hidden || !node) return;
  const c = canvas.getBoundingClientRect(), r = node.el.getBoundingClientRect();
  const w = panel.offsetWidth, h = panel.offsetHeight, gap = 12, pad = 8;
  let left = r.right - c.left + gap;
  if (left + w > c.width - pad) left = r.left - c.left - gap - w;
  left = Math.max(pad, Math.min(left, c.width - w - pad));
  const top = Math.max(pad, Math.min(r.top - c.top, c.height - h - pad));
  Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });
}

/** Redraws the panel for the current state of its block; hides it if the block is gone. */
export function renderMatrix(): void {
  const panel = $('#mxp');
  const node = openId != null ? nodeById(openId) : undefined;
  if (!node || !hasMatrix(node)) {
    openId = null;
    panel.hidden = true;
    return;
  }

  const pins = pinLabels(node).ins.map((l, k) => l || `pin ${k}`);
  const bits = pins.length;
  const size = 1 << bits;
  // A θ arriving on a classical wire overrides the typed angle.
  const wired = editor.sim?.angles.get(node.id);
  const varies = wired != null && Number.isNaN(wired);
  const raw = bits <= MAX_QUBITS && !varies ? blockMatrix({ ...node, p: wired ?? node.p }) : null;
  const order = textbook ? pins : [...pins].reverse();

  let body: string;
  if (bits > MAX_QUBITS) {
    body = `<p class="mut">Too large to show: ${size}×${size}.</p>`;
  } else if (varies) {
    body = '<p class="mut">Its angle differs between measurement branches, so there is no single matrix.</p>';
  } else if (!raw) {
    body = '<p class="mut">Not unitary: this gate collapses a measurement, so it has no single matrix.</p>';
  } else {
    body =
      table(textbook ? reverseQubitOrder(raw) : raw, bits) +
      (bits > 1 ? `<p class="cap">Basis |${order.map(escapeHtml).join(', ')}⟩</p>` : '') +
      (bits > TEXT_QUBITS ? '<p class="cap">Hover a cell for its value.</p>' : '') +
      (node.cond ? '<p class="cap">Applied only when its “if” value is non-zero; otherwise nothing happens.</p>' : '') +
      '<p class="cap">Colour = phase, strength = magnitude.</p>';
  }

  panel.innerHTML =
    `<div class="mh"><b>${escapeHtml(nodeTitle(node))}</b><span>${size}×${size}</span><span class="fill"></span>` +
    (bits > 1
      ? `<button class="p" id="mxo" title="Switch which qubit is written first">${textbook ? 'Pin 0 first' : 'Pin 0 last'}</button>`
      : '') +
    '<b class="mxc" title="Close (Esc)">×</b></div>' +
    body;
  panel.hidden = false;
  positionMatrix();
}

export function initMatrix(): void {
  viewListeners.push(positionMatrix);
  addEventListener('resize', positionMatrix);
  $('#mxp').addEventListener('click', (e) => {
    const target = e.target as Element;
    if (target.closest('.mxc')) {
      closeMatrix();
    } else if (target.closest('#mxo')) {
      textbook = !textbook;
      try {
        localStorage.setItem(ORDER_KEY, textbook ? 'textbook' : 'default');
      } catch {
        // Storage unavailable: the choice lasts until reload.
      }
      renderMatrix();
    }
  });
}
