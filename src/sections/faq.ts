// src/sections/faq.ts — acordeón de preguntas (recon §6). Fase 4.
// Abre una a la vez, con altura animada y scramble del título, accesible por teclado.
//
// El scramble va ATADO A LA APERTURA, no al hover, así que funciona igual con ratón, teclado
// y toque. Es la diferencia con `hovers.ts` (principios y stack), que sí depende de un cursor
// presente y por eso se apaga en táctil. La referencia scramblea el título tanto al pasar por
// encima como al activarlo (recon §6); aquí el hover se añade aparte y solo con puntero fino.

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { isTouch, prefersReducedMotion, type Module } from '../core/utils.ts';

export function initFaq(): Module {
  const questions = [...document.querySelectorAll<HTMLButtonElement>('[data-faq-q]')];
  if (questions.length === 0) return { destroy() {} };

  const reduced = prefersReducedMotion();

  /** Scramblea el texto de una pregunta hacia sí mismo: el efecto es el barajado. */
  const scramble = (q: HTMLButtonElement): void => {
    if (reduced) return;
    const span = q.querySelector<HTMLElement>('[data-faq-text]');
    if (!span) return;
    const texto = span.dataset.original ?? span.textContent ?? '';
    span.dataset.original = texto;
    gsap.to(span, {
      duration: 0.45,
      ease: 'none',
      scrambleText: { text: texto, chars: 'upperCase', speed: 1.4, revealDelay: 0.05 },
      overwrite: true,
    });
  };

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

    // Al abrir Y al cerrar: el barajado marca el cambio de estado en ambos sentidos.
    scramble(q);
  };

  for (const q of questions) q.addEventListener('click', onClick);

  // Hover solo con puntero fino, igual que principios y stack. El de la apertura, en cambio,
  // se conserva en táctil porque lo dispara el toque, no un cursor que se mantenga encima.
  const hoverables = isTouch() ? [] : questions;
  const onEnter = (e: Event): void => scramble(e.currentTarget as HTMLButtonElement);
  for (const q of hoverables) q.addEventListener('pointerenter', onEnter);

  return {
    destroy() {
      for (const q of questions) {
        q.removeEventListener('click', onClick);
        q.removeEventListener('pointerenter', onEnter);
        const span = q.querySelector<HTMLElement>('[data-faq-text]');
        if (span) {
          gsap.killTweensOf(span);
          if (span.dataset.original) span.textContent = span.dataset.original;
        }
        const panel = panelOf(q);
        if (panel) gsap.killTweensOf(panel);
      }
    },
  };
}
