// src/core/lenis.ts — smooth scroll sincronizado con el ticker de GSAP (§6.14). Fase 1.

import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { gsap, ScrollTrigger } from './gsap.ts';
import { prefersReducedMotion, type Module } from './utils.ts';

let instance: Lenis | null = null;

export function getLenis(): Lenis | null {
  return instance;
}

export function initLenis(): Module {
  // Con reduced motion no se instancia: el scroll nativo del navegador manda (§6.14).
  if (prefersReducedMotion()) {
    return { destroy() {} };
  }

  const lenis = new Lenis({ lerp: 0.08, wheelMultiplier: 1, smoothWheel: true });
  instance = lenis;

  lenis.on('scroll', ScrollTrigger.update);

  // Un solo loop manda: el ticker de GSAP conduce a Lenis (ms, no segundos).
  const raf = (time: number): void => {
    lenis.raf(time * 1000);
  };
  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);

  return {
    destroy() {
      gsap.ticker.remove(raf);
      lenis.destroy();
      instance = null;
    },
  };
}

/** Scroll a un ancla respetando la altura del nav (§6.14). */
export function scrollToTarget(target: string | HTMLElement): void {
  const lenis = instance;
  if (lenis) {
    lenis.scrollTo(target, { offset: -80, duration: 1.4 });
    return;
  }
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  el?.scrollIntoView({ block: 'start' });
}
