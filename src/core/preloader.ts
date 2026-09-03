// src/core/preloader.ts — overlay de acento con bloques + "LOADING" y salida en wipe horizontal. Fase 2.
// Corregido con la Fase 0 (recon/diff.md §B2): la referencia NO usa contador 000→100.

import { gsap } from './gsap.ts';
import { prefersReducedMotion, type Module } from './utils.ts';

const SESSION_KEY = 'javier:preloaded';
const MIN_DURATION = 1.2; // s — se muestra al menos esto aunque cargue antes (§6.1)

/** Espera a que las fuentes y la imagen del retrato estén listas (sin bloquear si fallan). */
async function assetsReady(): Promise<void> {
  const fonts = document.fonts.ready.catch(() => undefined);

  const portrait = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // aún no existe el asset: no bloquear (§7)
    img.src = '/img/portrait/portrait.png';
  });

  await Promise.all([fonts, portrait]);
}

export interface Preloader extends Module {
  /** Resuelve cuando el overlay empieza a salir: el hero solapa su entrada aquí (§6.1). */
  readonly done: Promise<void>;
}

export function initPreloader(): Preloader {
  const el = document.querySelector<HTMLElement>('[data-preloader]');

  if (!el) return { done: Promise.resolve(), destroy() {} };

  // Solo la primera visita de la sesión (§6.1)
  if (sessionStorage.getItem(SESSION_KEY) === '1') {
    el.remove();
    return { done: Promise.resolve(), destroy() {} };
  }

  document.documentElement.dataset.loading = 'true';
  el.removeAttribute('hidden');

  const reduced = prefersReducedMotion();
  const blocks = [...el.querySelectorAll<HTMLElement>('[data-block]')];
  let tl: gsap.core.Timeline | null = null;

  const done = (async (): Promise<void> => {
    const started = performance.now();

    if (!reduced) {
      // Los bloques se van llenando mientras carga
      tl = gsap.timeline({ repeat: -1 });
      tl.to(blocks, { opacity: 1, duration: 0.18, stagger: 0.16, ease: 'none' }).to(blocks, {
        opacity: 0.25,
        duration: 0.18,
        ease: 'none',
      });
    }

    await assetsReady();

    const elapsed = (performance.now() - started) / 1000;
    if (elapsed < MIN_DURATION) {
      await new Promise((r) => setTimeout(r, (MIN_DURATION - elapsed) * 1000));
    }

    tl?.kill();
    tl = null;

    sessionStorage.setItem(SESSION_KEY, '1');
    document.documentElement.dataset.loading = 'false';

    if (reduced) {
      await gsap.to(el, { autoAlpha: 0, duration: 0.3, ease: 'none' });
    } else {
      // Wipe horizontal: el overlay se va hacia la derecha con el borde ligeramente inclinado
      await gsap.to(el, { xPercent: 100, skewX: -3, duration: 1, ease: 'wipe' });
    }

    el.remove();
  })();

  return {
    done,
    destroy() {
      tl?.kill();
      gsap.killTweensOf(el);
      el.remove();
      document.documentElement.dataset.loading = 'false';
    },
  };
}
