// src/core/utils.ts — helpers compartidos. Fase 1.

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isTouch(): boolean {
  return window.matchMedia('(hover: none)').matches;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait = 200): (...args: A) => void {
  let id: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (id !== undefined) clearTimeout(id);
    id = setTimeout(() => fn(...args), wait);
  };
}

/** Escapa texto que se inserta en HTML generado desde site.ts. */
export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Contrato de todo módulo del sitio (§3): siempre destruible. */
export interface Module {
  destroy(): void;
}
