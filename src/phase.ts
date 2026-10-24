/** Below this transverse Bloch length (or amplitude) the phase is treated as undefined. */
export const PHASE_EPSILON = 0.05;

/** Hue of phase 0: the blue of a plain wire, so only relative phases stand out. */
const HUE_AT_ZERO = 220;

const degrees = (phi: number): number => (((phi * 180) / Math.PI) % 360 + 360) % 360;

/** Colour for a complex phase in radians: blue at 0, then around the colour wheel. */
export const phaseColor = (phi: number): string =>
  `hsl(${((degrees(phi) + HUE_AT_ZERO) % 360).toFixed(0)} 75% 55%)`;

export const formatDegrees = (phi: number): string => `${degrees(phi).toFixed(0)}°`;
