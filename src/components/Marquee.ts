// src/components/Marquee.ts — banda infinita que acelera con el scroll (§6.9). Fase 4.

import { gsap } from '../core/gsap.ts';
import { getLenis } from '../core/lenis.ts';
import { clamp, lerp, prefersReducedMotion, type Module } from '../core/utils.ts';

const BASE_DURATION = 20;
const MAX_BOOST = 3;

export function initMarquee(): Module {
  const track = document.querySelector<HTMLElement>('[data-marquee]');
  if (!track) return { destroy() {} };

  // Con reduced motion la banda se queda quieta: es decorativa y ya está en aria-hidden
  if (prefersReducedMotion()) return { destroy() {} };

  const loop = gsap.to(track, {
    xPercent: -50,
    repeat: -1,
    ease: 'none',
    duration: BASE_DURATION,
  });

  let boost = 1;

  const tick = (): void => {
    const lenis = getLenis();
    const velocity = lenis?.velocity ?? 0;

    // La velocidad empuja el timeScale y vuelve a 1 con lerp; el signo invierte la dirección
    const target = 1 + clamp(Math.abs(velocity) * 0.05, 0, MAX_BOOST);
    boost = lerp(boost, target, 0.1);
    loop.timeScale(velocity < -1 ? -boost : boost);
  };

  gsap.ticker.add(tick);

  return {
    destroy() {
      gsap.ticker.remove(tick);
      loop.kill();
      gsap.set(track, { xPercent: 0 });
    },
  };
}
