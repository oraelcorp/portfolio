// src/components/MagneticButton.ts — botones que se acercan al puntero (§6.5). Fase 2.
// DIFERENCIADOR INTENCIONAL: la referencia NO tiene magnetismo (medido en recon/nav-behavior.json);
// Javier lo quiere igualmente como sello propio del portafolio.

import { gsap } from '../core/gsap.ts';
import { clamp, prefersReducedMotion, isTouch, type Module } from '../core/utils.ts';

const AREA = 1.6; // el área activa es 1.6× el tamaño del botón
const PULL = 0.35; // cuánto se desplaza el botón respecto al puntero
const INNER_PULL = 0.15; // parallax adicional del contenido interior

// El §6.5 da la fórmula sin tope. En un CTA ancho (~240 px) eso son ~51 px de arrastre y el
// label se sale de la caja del botón. Se acota el desplazamiento sin tocar la sensación.
const MAX_PULL = 14;
const MAX_INNER = 5;

interface Magnetic {
  el: HTMLElement;
  setX: (v: number) => void;
  setY: (v: number) => void;
  setInnerX: ((v: number) => void) | null;
  setInnerY: ((v: number) => void) | null;
  active: boolean;
}

function create(el: HTMLElement): Magnetic {
  const inner = el.querySelector<HTMLElement>('[data-magnetic-inner]');
  const opts = { duration: 0.6, ease: 'main' } as const;

  return {
    el,
    // quickTo escribe valores ABSOLUTOS, así el transform nunca se acumula (criterio §9 Fase 2)
    setX: gsap.quickTo(el, 'x', opts),
    setY: gsap.quickTo(el, 'y', opts),
    setInnerX: inner ? gsap.quickTo(inner, 'x', opts) : null,
    setInnerY: inner ? gsap.quickTo(inner, 'y', opts) : null,
    active: false,
  };
}

function release(item: Magnetic): void {
  item.active = false;
  gsap.to(item.el, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1, 0.4)', overwrite: true });
  const inner = item.el.querySelector<HTMLElement>('[data-magnetic-inner]');
  if (inner) gsap.to(inner, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1, 0.4)', overwrite: true });
}

export function initMagnetic(): Module {
  // Sin puntero fino o con reduced motion no aporta nada y estorba (§6.14)
  if (prefersReducedMotion() || isTouch()) return { destroy() {} };

  const items = [...document.querySelectorAll<HTMLElement>('[data-magnetic]')].map(create);
  if (items.length === 0) return { destroy() {} };

  const onMove = (event: PointerEvent): void => {
    for (const item of items) {
      const r = item.el.getBoundingClientRect();
      if (r.width === 0) continue;

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;

      const inside = Math.abs(dx) < (r.width * AREA) / 2 && Math.abs(dy) < (r.height * AREA) / 2;

      if (inside) {
        item.active = true;
        item.setX(clamp(dx * PULL, -MAX_PULL, MAX_PULL));
        item.setY(clamp(dy * PULL, -MAX_PULL, MAX_PULL));
        item.setInnerX?.(clamp(dx * INNER_PULL, -MAX_INNER, MAX_INNER));
        item.setInnerY?.(clamp(dy * INNER_PULL, -MAX_INNER, MAX_INNER));
      } else if (item.active) {
        release(item);
      }
    }
  };

  window.addEventListener('pointermove', onMove, { passive: true });

  return {
    destroy() {
      window.removeEventListener('pointermove', onMove);
      for (const item of items) {
        gsap.killTweensOf(item.el);
        gsap.set(item.el, { x: 0, y: 0 });
      }
    },
  };
}
