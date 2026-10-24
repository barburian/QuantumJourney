export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

export const canvas = $<HTMLDivElement>('#cv');
export const world = $<HTMLDivElement>('#world');
export const wireLayer = $<SVGSVGElement>('#wires');

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);
