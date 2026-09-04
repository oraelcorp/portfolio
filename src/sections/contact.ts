// src/sections/contact.ts — halo del acento que sigue al puntero (§6.12). Fase 4.
// Se actualizan --mx/--my y el CSS pinta el radial: nada de tweens por frame.

import { gsap } from '../core/gsap.ts';
import { isTouch, prefersReducedMotion, type Module } from '../core/utils.ts';

export function initContact(): Module {
  const section = document.querySelector<HTMLElement>('[data-contact]');
  if (!section || prefersReducedMotion() || isTouch()) return { destroy() {} };

  // quickTo suaviza el seguimiento sin escribir el estilo en cada pointermove
  const setX = gsap.quickTo(section, '--mx', { duration: 0.6, ease: 'main' });
  const setY = gsap.quickTo(section, '--my', { duration: 0.6, ease: 'main' });

  const onMove = (event: PointerEvent): void => {
    const r = section.getBoundingClientRect();
    setX(((event.clientX - r.left) / r.width) * 100);
    setY(((event.clientY - r.top) / r.height) * 100);
  };

  const onEnter = (): void => {
    gsap.to(section, { '--halo': 1, duration: 0.5, ease: 'main' } as gsap.TweenVars);
  };

  const onLeave = (): void => {
    gsap.to(section, { '--halo': 0, duration: 0.6, ease: 'main' } as gsap.TweenVars);
  };

  section.addEventListener('pointermove', onMove);
  section.addEventListener('pointerenter', onEnter);
  section.addEventListener('pointerleave', onLeave);

  return {
    destroy() {
      section.removeEventListener('pointermove', onMove);
      section.removeEventListener('pointerenter', onEnter);
      section.removeEventListener('pointerleave', onLeave);
      gsap.killTweensOf(section);
      section.style.removeProperty('--mx');
      section.style.removeProperty('--my');
      section.style.removeProperty('--halo');
    },
  };
}
