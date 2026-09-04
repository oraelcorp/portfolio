// src/sections/hovers.ts — scramble en los títulos de principios y en los nombres del stack.
// Es el mismo recurso que usa la referencia en su rejilla "THE BUILD" (recon §5). Fase 4.

import { gsap } from '../core/gsap.ts';
import { prefersReducedMotion, isTouch, type Module } from '../core/utils.ts';

const SELECTOR = '.principles__title, .stack__name';

export function initHovers(): Module {
  if (prefersReducedMotion() || isTouch()) return { destroy() {} };

  const targets = [...document.querySelectorAll<HTMLElement>(SELECTOR)];
  const cleanups: Array<() => void> = [];

  for (const el of targets) {
    // El texto vive junto a un <i class="bullet">, así que se scramblea solo el nodo de texto
    const textNode = [...el.childNodes].find(
      (n): n is Text => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
    );
    if (!textNode) continue;

    const original = textNode.textContent ?? '';

    // scrambleText necesita un elemento, no un nodo de texto suelto
    const span = document.createElement('span');
    span.textContent = original;
    textNode.replaceWith(span);

    const onEnter = (): void => {
      gsap.to(span, {
        duration: 0.5,
        ease: 'none',
        scrambleText: { text: original, chars: 'upperCase', speed: 1.4, revealDelay: 0.05 },
        overwrite: true,
      });
    };

    el.addEventListener('pointerenter', onEnter);
    cleanups.push(() => {
      el.removeEventListener('pointerenter', onEnter);
      gsap.killTweensOf(span);
      span.textContent = original;
    });
  }

  return {
    destroy() {
      for (const c of cleanups) c();
    },
  };
}
