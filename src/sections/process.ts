// src/sections/process.ts — scrollytelling: el paso activo se enciende y la media sticky
// cambia con él (recon §3). Fase 4.

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';

/**
 * Suelo de atenuación de los pasos inactivos. Se LEE del CSS (`--process-dim`) para que la
 * media query pueda subirlo en móvil, donde se ven varios pasos a la vez y el 0.32 de
 * escritorio deja el texto por debajo de AA.
 */
function suelo(el: Element): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue('--process-dim'));
  return Number.isFinite(v) ? v : 0.32;
}

export function initProcess(): Module {
  const steps = [...document.querySelectorAll<HTMLElement>('[data-step]')];
  const media = [...document.querySelectorAll<HTMLElement>('[data-process-media-item]')];
  if (steps.length === 0) return { destroy() {} };

  // Con reduced motion se muestran todos los pasos por igual, sin atenuar
  if (prefersReducedMotion()) {
    for (const s of steps) s.dataset.active = 'true';
    for (const m of media) m.dataset.active = 'true';
    return { destroy() {} };
  }

  let current = -1;

  const activate = (index: number): void => {
    if (index === current) return;
    current = index;

    steps.forEach((step, i) => {
      const on = i === index;
      step.dataset.active = String(on);
      const dim = suelo(step.closest('.process__body') ?? step);
      gsap.to(step, { autoAlpha: on ? 1 : dim, duration: 0.4, ease: 'main', overwrite: 'auto' });
    });

    // Crossfade de la media: solo la del paso activo queda visible
    media.forEach((item, i) => {
      const on = i === index;
      item.dataset.active = String(on);
      gsap.to(item, { autoAlpha: on ? 1 : 0, duration: 0.5, ease: 'main', overwrite: 'auto' });
    });
  };

  const triggers = steps.map((step, i) =>
    ScrollTrigger.create({
      trigger: step,
      // El paso manda mientras cruza la banda central del viewport
      start: 'top 65%',
      end: 'bottom 45%',
      onToggle: (self) => {
        if (self.isActive) activate(i);
      },
    }),
  );

  activate(0);

  return {
    destroy() {
      for (const t of triggers) t.kill();
      gsap.killTweensOf([...steps, ...media]);
      for (const s of steps) gsap.set(s, { autoAlpha: 1 });
    },
  };
}
