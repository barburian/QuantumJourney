/* Keeps custom gate definitions in the browser and tells the UI when they change. */
import { defs, type CustomDef } from './custom';

const STORAGE_KEY = 'qb-gates';
const listeners: (() => void)[] = [];

/** Loads the stored gates into `defs`. */
export function loadStoredGates(): void {
  try {
    const stored: CustomDef[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    for (const d of stored) defs.set(d.id, d);
  } catch {
    // Storage unavailable or corrupt: start without stored gates.
  }
}

export function onGatesChanged(listener: () => void): void {
  listeners.push(listener);
}

/** Stores every gate and updates whatever shows them. Call after any change to `defs`. */
export function gatesChanged(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...defs.values()]));
  } catch {
    // Storage unavailable: gates just won't survive a reload.
  }
  for (const listener of listeners) listener();
}
