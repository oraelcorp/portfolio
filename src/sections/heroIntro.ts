// src/sections/heroIntro.ts — entrada del hero solapada con la salida del preloader (§6.4). Fase 4.
// Cierra la deuda que quedó de la Fase 2: el titular arranca cuando el overlay EMPIEZA su wipe,
// así el texto aparece por debajo mientras el acento se va, en vez de después.

import { gsap } from '../core/gsap.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';
import { splitReveal } from '../components/SplitReveal.ts';

/** `exiting` es el momento en que el preloader arranca su salida. */
export function initHeroIntro(exiting: Promise<void>): Module {
  const title = document.querySelector<HTMLElement>('[data-hero-title]');
  const sub = document.querySelector<HTMLElement>('[data-hero-sub]');
  const actions = document.querySelector<HTMLElement>('[data-hero-actions]');
  const clients = [...document.querySelectorAll<HTMLElement>('[data-hero-clients] > *')];

  if (!title) return { destroy() {} };

  const reduced = prefersReducedMotion();
  const reveal = splitReveal(title, { trigger: 'manual', duration: 1.1, stagger: 0.08 });

  const rest = [sub, actions].filter((el): el is HTMLElement => el !== null);

  if (reduced) {
    // Sin animación: todo en su estado final (§6.14)
    gsap.set([...rest, ...clients], { autoAlpha: 1, y: 0 });
    return {
      destroy() {
        reveal.destroy();
      },
    };
  }

  // Estado inicial antes de que el preloader se vaya
  gsap.set(rest, { autoAlpha: 0, y: 20 });
  gsap.set(clients, { autoAlpha: 0 });

  let tl: gsap.core.Timeline | null = null;

  void exiting.then(() => {
    reveal.play();

    tl = gsap.timeline();
    tl.to(rest[0] ?? {}, { autoAlpha: 1, y: 0, duration: 0.8, ease: 'main' }, 0.5)
      .to(rest[1] ?? {}, { autoAlpha: 1, y: 0, duration: 0.8, ease: 'main' }, 0.7)
      .to(clients, { autoAlpha: 1, duration: 0.6, ease: 'none', stagger: 0.08 }, 0.9);
  });

  return {
    destroy() {
      tl?.kill();
      reveal.destroy();
      gsap.killTweensOf([...rest, ...clients]);
    },
  };
}
