// src/sections/heroIntro.ts — entrada del hero solapada con la salida del preloader (§6.4). Fase 4.
// Cierra la deuda que quedó de la Fase 2: el titular arranca cuando el overlay EMPIEZA su wipe,
// así el texto aparece por debajo mientras el acento se va, en vez de después.

import { gsap } from '../core/gsap.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';
import { barWipe } from '../components/BarWipe.ts';

/** `exiting` es el momento en que el preloader arranca su salida. */
export function initHeroIntro(exiting: Promise<void>): Module {
  const title = document.querySelector<HTMLElement>('[data-hero-title]');
  const sub = document.querySelector<HTMLElement>('[data-hero-sub]');
  const actions = document.querySelector<HTMLElement>('[data-hero-actions]');
  const clients = [...document.querySelectorAll<HTMLElement>('[data-hero-clients] > *')];

  if (!title) return { destroy() {} };

  const reduced = prefersReducedMotion();
  // El titular entra con el BARRIDO DE DOS BARRAS medido en la referencia
  // (`recon/texto-entrada.txt`, mecánica en `components/BarWipe.ts`). Sustituye al revelado por
  // líneas enmascaradas que había: no es un cambio de gusto, es que la referencia no desliza el
  // texto — lo imprime detrás de una barra.
  //
  // `stagger` es lo único que NO sale de la medición: su h2 era de una sola línea, así que no
  // había desfase entre líneas que medir. Se usa el 0.08 del resto de reveals del sitio.
  const reveal = barWipe(title, { trigger: 'manual', stagger: 0.08 });

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
    tl.to(rest[0] ?? {}, { autoAlpha: 1, y: 0, duration: 1.2, ease: 'silk' }, 0.7)
      .to(rest[1] ?? {}, { autoAlpha: 1, y: 0, duration: 1.2, ease: 'silk' }, 0.95)
      .to(clients, { autoAlpha: 1, duration: 0.9, ease: 'none', stagger: 0.1 }, 1.2);
  });

  return {
    destroy() {
      tl?.kill();
      reveal.destroy();
      gsap.killTweensOf([...rest, ...clients]);
    },
  };
}
