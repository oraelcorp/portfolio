// src/sections/work.ts — showcase: la pestaña activa sigue al scroll y la pill "VIEW PROJECT"
// persigue al cursor sobre la imagen (recon §4). Fase 4.

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { isTouch, prefersReducedMotion, type Module } from '../core/utils.ts';

export function initWork(): Module {
  const previews = [...document.querySelectorAll<HTMLElement>('[data-work-preview]')];
  const tabs = [...document.querySelectorAll<HTMLElement>('[data-work-tab]')];
  if (previews.length === 0) return { destroy() {} };

  const modules: Module[] = [];
  const reduced = prefersReducedMotion();

  // --- La pestaña de la izquierda sigue al proyecto que se está viendo
  if (tabs.length > 0) {
    const triggers = previews.map((preview, i) =>
      ScrollTrigger.create({
        trigger: preview,
        start: 'top 60%',
        end: 'bottom 40%',
        onToggle: (self) => {
          if (!self.isActive) return;
          tabs.forEach((tab, j) => {
            tab.dataset.active = String(i === j);
          });
        },
      }),
    );
    modules.push({
      destroy() {
        for (const t of triggers) t.kill();
      },
    });
  }

  // --- La pill sigue al cursor dentro de su figura (§6.7). En touch se queda fija.
  if (!reduced && !isTouch()) {
    for (const preview of previews) {
      const figure = preview.querySelector<HTMLElement>('.work__figure');
      const pill = preview.querySelector<HTMLElement>('.work__pill');
      if (!figure || !pill) continue;

      gsap.set(pill, { autoAlpha: 0, xPercent: -50, yPercent: -50 });

      const toX = gsap.quickTo(pill, 'x', { duration: 0.5, ease: 'main' });
      const toY = gsap.quickTo(pill, 'y', { duration: 0.5, ease: 'main' });

      const onMove = (event: PointerEvent): void => {
        const r = figure.getBoundingClientRect();
        toX(event.clientX - r.left);
        toY(event.clientY - r.top);
      };

      const onEnter = (event: PointerEvent): void => {
        const r = figure.getBoundingClientRect();
        // Sin transición al entrar: la pill aparece ya bajo el cursor
        gsap.set(pill, { x: event.clientX - r.left, y: event.clientY - r.top });
        gsap.to(pill, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'main', overwrite: true });
      };

      const onLeave = (): void => {
        gsap.to(pill, { autoAlpha: 0, scale: 0.8, duration: 0.3, ease: 'main', overwrite: true });
      };

      figure.addEventListener('pointerenter', onEnter);
      figure.addEventListener('pointermove', onMove);
      figure.addEventListener('pointerleave', onLeave);

      modules.push({
        destroy() {
          figure.removeEventListener('pointerenter', onEnter);
          figure.removeEventListener('pointermove', onMove);
          figure.removeEventListener('pointerleave', onLeave);
          gsap.killTweensOf(pill);
          gsap.set(pill, { clearProps: 'all' });
        },
      });
    }
  }

  return {
    destroy() {
      for (const m of modules) m.destroy();
    },
  };
}
