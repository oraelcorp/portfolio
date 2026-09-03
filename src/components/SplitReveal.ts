// src/components/SplitReveal.ts — revelado de titulares línea a línea con SplitText (§6.4). Fase 4.
// La referencia usa type:"lines" (confirmado en Fase 0), no palabras sueltas.
//
// Se usa `autoSplit: true`: SplitText rehace la división al cambiar el ancho o al cargar las
// fuentes, y `onSplit` devuelve el tween para que GSAP lo mate y lo recree solo. Eso cubre lo
// que §6.14 pedía con un debounce manual de 200 ms, sin escribirlo.

import { gsap, ScrollTrigger, SplitText } from '../core/gsap.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';

export interface SplitRevealOptions {
  /** Si se omite, entra al llegar al 80 % del viewport (§6.7). */
  trigger?: 'scroll' | 'manual';
  delay?: number;
  stagger?: number;
  duration?: number;
}

export interface SplitRevealHandle extends Module {
  /** Dispara la entrada cuando `trigger` es 'manual' (el hero la usa tras el preloader). */
  play(delay?: number): void;
}

/**
 * Revela un titular por líneas enmascaradas. Devuelve un handle para poder dispararlo a mano.
 */
export function splitReveal(el: HTMLElement, options: SplitRevealOptions = {}): SplitRevealHandle {
  const { trigger = 'scroll', delay = 0, stagger = 0.08, duration = 1.1 } = options;
  const reduced = prefersReducedMotion();

  if (reduced) {
    // Estado final directo: nada de animación, pero el texto debe verse (§6.14)
    gsap.set(el, { autoAlpha: 1 });
    return { play() {}, destroy() {} };
  }

  let split: SplitText | null = null;
  let st: ScrollTrigger | null = null;
  let played = trigger === 'scroll';

  split = SplitText.create(el, {
    type: 'lines',
    mask: 'lines',
    autoSplit: true,
    // aria "auto" deja el texto original accesible aunque se trocee en <div>s
    aria: 'auto',
    onSplit(self) {
      const tween = gsap.from(self.lines, {
        yPercent: 110,
        duration,
        ease: 'main',
        stagger,
        delay,
        // En modo manual el titular espera: se arranca desde play()
        paused: !played,
      });

      if (trigger === 'scroll') {
        st?.kill();
        st = ScrollTrigger.create({
          trigger: el,
          start: 'top 80%',
          once: true,
          animation: tween,
        });
      }

      return tween;
    },
  });

  return {
    play(extraDelay = 0) {
      played = true;
      const lines = split?.lines ?? [];
      if (lines.length === 0) return;
      gsap.fromTo(
        lines,
        { yPercent: 110 },
        { yPercent: 0, duration, ease: 'main', stagger, delay: delay + extraDelay, overwrite: true },
      );
    },
    destroy() {
      st?.kill();
      st = null;
      split?.revert();
      split = null;
    },
  };
}
