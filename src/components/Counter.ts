// src/components/Counter.ts — cifras que ruedan como un odómetro al entrar (recon §2). Fase 4.
// Cada dígito es una columna 0–9 que sube hasta su valor; lo que no es dígito ("+") se queda fijo.

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';

const DIGITS = '0123456789';

/** Convierte "2+" en una columna rodante para el 2 y un carácter fijo para el +. */
function buildColumns(el: HTMLElement, value: string): HTMLElement[] {
  el.textContent = '';
  el.classList.add('counter');

  const columns: HTMLElement[] = [];

  for (const char of value) {
    if (!DIGITS.includes(char)) {
      const fixed = document.createElement('span');
      fixed.className = 'counter__fixed';
      fixed.textContent = char;
      el.append(fixed);
      continue;
    }

    const slot = document.createElement('span');
    slot.className = 'counter__slot';

    const strip = document.createElement('span');
    strip.className = 'counter__strip';
    // 0–9 y otra vez el dígito final, para que la última vuelta caiga en su sitio
    strip.textContent = `${DIGITS}${char}`.split('').join('\n');
    strip.dataset.target = char;

    slot.append(strip);
    el.append(slot);
    columns.push(strip);
  }

  return columns;
}

export function initCounters(): Module {
  const targets = [...document.querySelectorAll<HTMLElement>('[data-counter]')];
  if (targets.length === 0) return { destroy() {} };

  const reduced = prefersReducedMotion();
  const triggers: ScrollTrigger[] = [];

  for (const el of targets) {
    const value = el.dataset.counter ?? '';
    // Los valores pendientes se dejan como están: el [TODO] tiene que seguir viéndose (§10.5)
    if (!value || value.startsWith('[')) continue;

    const columns = buildColumns(el, value);
    if (columns.length === 0 || reduced) continue;

    // La tira mide 11 líneas; hay que subir 10 para llegar a la repetición final
    gsap.set(columns, { yPercent: 0 });

    triggers.push(
      ScrollTrigger.create({
        trigger: el,
        start: 'top 85%',
        once: true,
        animation: gsap.to(columns, {
          yPercent: -(10 / 11) * 100,
          duration: 1.6,
          ease: 'main',
          stagger: 0.12,
        }),
      }),
    );
  }

  return {
    destroy() {
      for (const t of triggers) t.kill();
    },
  };
}
