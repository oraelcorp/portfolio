// src/sections/faq.ts — acordeón de preguntas (recon §6). Fase 4.
// Abre una a la vez, con altura animada y scramble del título, accesible por teclado.

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';

export function initFaq(): Module {
  const questions = [...document.querySelectorAll<HTMLButtonElement>('[data-faq-q]')];
  if (questions.length === 0) return { destroy() {} };

  const reduced = prefersReducedMotion();

  const panelOf = (q: HTMLButtonElement): HTMLElement | null => {
    const id = q.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  };

  const close = (q: HTMLButtonElement, animate = true): void => {
    const panel = panelOf(q);
    if (!panel || q.getAttribute('aria-expanded') !== 'true') return;

    q.setAttribute('aria-expanded', 'false');

    if (!animate || reduced) {
      panel.hidden = true;
      return;
    }

    gsap.to(panel, {
      height: 0,
      autoAlpha: 0,
      duration: 0.4,
      ease: 'main',
      overwrite: true,
      onComplete: () => {
        panel.hidden = true;
        gsap.set(panel, { height: 'auto', autoAlpha: 1 });
        ScrollTrigger.refresh();
      },
    });
  };

  const open = (q: HTMLButtonElement): void => {
    const panel = panelOf(q);
    if (!panel) return;

    q.setAttribute('aria-expanded', 'true');
    panel.hidden = false;

    if (reduced) return;

    gsap.fromTo(
      panel,
      { height: 0, autoAlpha: 0 },
      {
        height: 'auto',
        autoAlpha: 1,
        duration: 0.5,
        ease: 'main',
        overwrite: true,
        // El layout cambia: hay que recalcular los triggers de más abajo (§6.14)
        onComplete: () => ScrollTrigger.refresh(),
      },
    );
  };

  const onClick = (event: MouseEvent): void => {
    const q = (event.currentTarget as HTMLButtonElement | null) ?? null;
    if (!q) return;

    const wasOpen = q.getAttribute('aria-expanded') === 'true';
    for (const other of questions) if (other !== q) close(other);

    if (wasOpen) close(q);
    else open(q);
  };

  for (const q of questions) q.addEventListener('click', onClick);

  return {
    destroy() {
      for (const q of questions) {
        q.removeEventListener('click', onClick);
        const panel = panelOf(q);
        if (panel) gsap.killTweensOf(panel);
      }
    },
  };
}
