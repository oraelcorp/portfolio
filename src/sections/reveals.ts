// src/sections/reveals.ts — entradas por scroll de todas las secciones (§6.6–6.13). Fase 4.
// Un solo módulo porque el patrón se repite: titular por líneas + contenido con stagger,
// todo `once: true` al 80 % del viewport.

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';
import { splitReveal, type SplitRevealHandle } from '../components/SplitReveal.ts';

interface Group {
  /** Selector de los elementos que entran con stagger. */
  items: string;
  y?: number;
  stagger?: number;
  /**
   * No tocar la opacidad en la entrada. Hace falta cuando OTRO módulo ya la gobierna: los
   * pasos del proceso los atenúa el scrollytelling, y como el tween de `from` se construye
   * al crear el trigger —antes de que `activate()` aplique el suelo— capturaba opacidad 1
   * como destino y BORRABA la atenuación al entrar en la sección. Solo reaparecía al cruzar
   * el siguiente límite de paso.
   */
  soloY?: boolean;
}

/** Cada grupo entra al llegar su contenedor al 80 % del viewport. */
const GROUPS: Group[] = [
  { items: '[data-section="stats"] .stats > *', y: 40, stagger: 0.1 },
  { items: '[data-section="process"] [data-step]', y: 40, stagger: 0.1, soloY: true },
  { items: '[data-section="work"] [data-work-preview]', y: 40, stagger: 0.1 },
  { items: '[data-section="principles"] .principles__item', y: 30, stagger: 0.08 },
  { items: '[data-section="stack"] .stack__group', y: 30, stagger: 0.08 },
  { items: '[data-section="faq"] .faq__item', y: 24, stagger: 0.06 },
  { items: '[data-section="contact"] .contact__details > *', y: 24, stagger: 0.1 },
];

/** Hairlines que se dibujan de izquierda a derecha al entrar (§6.8). */
const RULES = '[data-section="principles"] .principles__title, [data-section="stack"] .stack__name';

export function initReveals(): Module {
  const reduced = prefersReducedMotion();
  const modules: Module[] = [];
  const triggers: ScrollTrigger[] = [];

  // Titulares de sección
  const headings = [...document.querySelectorAll<HTMLElement>('[data-section] h2')];
  const reveals: SplitRevealHandle[] = headings.map((h) => splitReveal(h));
  modules.push(...reveals);

  if (reduced) {
    return {
      destroy() {
        for (const m of modules) m.destroy();
      },
    };
  }

  for (const group of GROUPS) {
    const items = [...document.querySelectorAll<HTMLElement>(group.items)];
    if (items.length === 0) continue;

    const first = items[0];
    if (!first) continue;

    triggers.push(
      ScrollTrigger.create({
        trigger: first.parentElement ?? first,
        start: 'top 80%',
        once: true,
        animation: gsap.from(items, {
          y: group.y ?? 30,
          ...(group.soloY ? {} : { autoAlpha: 0 }),
          duration: 0.9,
          ease: 'main',
          stagger: group.stagger ?? 0.08,
        }),
      }),
    );
  }

  // El borde superior se dibuja en vez de aparecer
  for (const rule of document.querySelectorAll<HTMLElement>(RULES)) {
    triggers.push(
      ScrollTrigger.create({
        trigger: rule,
        start: 'top 88%',
        once: true,
        animation: gsap.from(rule, {
          '--rule-scale': 0,
          duration: 0.8,
          ease: 'main',
        } as gsap.TweenVars),
      }),
    );
  }

  return {
    destroy() {
      for (const t of triggers) t.kill();
      for (const m of modules) m.destroy();
    },
  };
}
