/* Rendering of probe blocks: Bloch sphere, readout and amplitude chart. */
import { $ } from './dom';
import { formatDegrees, PHASE_EPSILON, phaseColor } from './phase';
import type { ProbeReading } from './simulator';

const RADIUS = 46;
/** Camera azimuth and elevation of the sphere's orthographic view. */
const AZIMUTH = Math.PI / 6;
const ELEVATION = Math.PI / 9;
/** Amplitude charts are skipped above this many basis states. */
const MAX_BARS = 32;

/** Projects a Bloch-space point to SVG coordinates (z up, x toward the viewer, y to the right). */
function project(x: number, y: number, z: number): string {
  const u = -x * Math.sin(AZIMUTH) + y * Math.cos(AZIMUTH);
  const depth = x * Math.cos(AZIMUTH) + y * Math.sin(AZIMUTH);
  const v = z * Math.cos(ELEVATION) - depth * Math.sin(ELEVATION);
  return `${(RADIUS * u).toFixed(1)},${(-RADIUS * v).toFixed(1)}`;
}

function ring(point: (t: number) => [number, number, number]): string {
  const steps = 48;
  const pts = Array.from({ length: steps + 1 }, (_, i) => project(...point((i / steps) * 2 * Math.PI)));
  return `M${pts.join('L')}`;
}

const SPHERE =
  `<circle class="sphere" r="${RADIUS}"/>` +
  `<path class="eq" d="${ring((t) => [Math.cos(t), Math.sin(t), 0])}"/>` +
  `<path class="eq" d="${ring((t) => [Math.cos(t), 0, Math.sin(t)])}"/>` +
  `<path class="ax" d="M${project(-1, 0, 0)}L${project(1, 0, 0)}M${project(0, -1, 0)}L${project(0, 1, 0)}` +
  `M${project(0, 0, -1)}L${project(0, 0, 1)}"/>` +
  [
    ['|0⟩', project(0, 0, 1.22)],
    ['|1⟩', project(0, 0, -1.22)],
    ['x', project(1.3, 0, 0)],
    ['y', project(0, 1.22, 0)],
  ]
    .map(([label, at]) => {
      const [x, y] = at.split(',');
      return `<text x="${x}" y="${y}">${label}</text>`;
    })
    .join('');

function blochSvg(r: ProbeReading | undefined): string {
  if (!r) return SPHERE;
  const [x, y, z] = r.bloch;
  const transverse = Math.hypot(x, y);
  const color = transverse < PHASE_EPSILON ? 'var(--wire)' : phaseColor(Math.atan2(y, x));
  const tip = project(x, y, z);
  return (
    SPHERE +
    `<path class="drop" d="M${tip}L${project(x, y, 0)}"/>` +
    `<path class="vec" style="stroke:${color}" d="M0,0L${tip}"/>` +
    `<circle class="tip" style="fill:${color}" r="3.5" cx="${tip.split(',')[0]}" cy="${tip.split(',')[1]}"/>`
  );
}

function describe(r: ProbeReading): string {
  const [x, y, z] = r.bloch;
  const length = Math.hypot(x, y, z);
  const lines = [`q${r.qubit} · P(1) ${(r.p1 * 100).toFixed(1)}%`];
  if (length > 1e-6) {
    const theta = Math.acos(Math.max(-1, Math.min(1, z / length)));
    const phase = Math.hypot(x, y) < PHASE_EPSILON ? '' : ` · φ ${formatDegrees(Math.atan2(y, x))}`;
    lines.push(`θ ${formatDegrees(theta)}${phase}`);
  }
  if (r.entangled) lines.push('Entangled with other qubits');
  else if (length < 1 - 1e-6) lines.push('Mixed by measurement');
  return lines.join('\n');
}

function amplitudeBars(r: ProbeReading): { bars: string; caption: string } {
  if (!r.amplitudes) return { bars: '', caption: `Mixed: ${r.branches} measurement branches` };
  if (r.amplitudes.length > MAX_BARS) return { bars: '', caption: 'Too many basis states to chart' };
  const n = Math.log2(r.amplitudes.length);
  const bars = r.amplitudes
    .map(({ re, im }, i) => {
      const mag = Math.hypot(re, im);
      const phi = Math.atan2(im, re);
      const color = mag < 1e-6 ? 'transparent' : phaseColor(phi);
      const label = `|${i.toString(2).padStart(n, '0')}⟩ ${mag.toFixed(3)} ∠ ${formatDegrees(phi)}`;
      return `<i title="${label}" style="height:${(mag * 100).toFixed(1)}%;--c:${color}"></i>`;
    })
    .join('');
  return { bars, caption: 'Amplitudes · colour = phase' };
}

export function renderProbe(el: HTMLElement, reading: ProbeReading | undefined): void {
  $('.bloch', el).innerHTML = blochSvg(reading);
  const { bars, caption } = reading ? amplitudeBars(reading) : { bars: '', caption: '' };
  $('.pv', el).textContent = reading ? describe(reading) : 'Not connected';
  $('.amps', el).innerHTML = bars;
  $('.pa', el).textContent = caption;
}
