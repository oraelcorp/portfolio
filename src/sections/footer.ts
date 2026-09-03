// src/sections/footer.ts — wordmark que entra con el scroll, reloj local y easter eggs (§6.13). Fase 4.
// Los atajos G (rejilla) y C (cambia el acento) están copiados de la referencia, que los anuncia
// en su propio footer — son parte de lo que se replica.

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { site } from '../content/site.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';

/** Acentos alternativos del easter egg "C". El primero es el de marca (§4.1). */
const ACCENTS = ['#39FF6A', '#FF4D00', '#4D7CFF', '#FFD166', '#FF5FA2'];

function initClock(): Module {
  const el = document.querySelector<HTMLElement>('[data-clock]');
  if (!el) return { destroy() {} };

  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: site.meta.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const paint = (): void => {
    el.textContent = format.format(new Date());
  };

  paint();
  const id = setInterval(paint, 1000);

  return {
    destroy() {
      clearInterval(id);
    },
  };
}

/** El wordmark gigante sube desde abajo con scrub, quedando recortado por el borde (§6.13). */
function initWordmark(): Module {
  const el = document.querySelector<HTMLElement>('.footer__wordmark');
  if (!el || prefersReducedMotion()) return { destroy() {} };

  const trigger = ScrollTrigger.create({
    trigger: el,
    start: 'top bottom',
    end: 'bottom bottom',
    scrub: true,
    animation: gsap.fromTo(el, { yPercent: 30 }, { yPercent: 0, ease: 'none' }),
  });

  return {
    destroy() {
      trigger.kill();
      gsap.set(el, { yPercent: 0 });
    },
  };
}

/** G alterna la rejilla de 12 columnas · C rota el acento. Anunciados en el propio footer. */
function initHotkeys(): Module {
  let accent = 0;
  let grid: HTMLElement | null = null;

  const toggleGrid = (): void => {
    if (grid) {
      grid.remove();
      grid = null;
      return;
    }
    grid = document.createElement('div');
    grid.className = 'grid-overlay';
    grid.setAttribute('aria-hidden', 'true');
    grid.innerHTML = '<div class="container">' + '<span></span>'.repeat(12) + '</div>';
    document.body.append(grid);
  };

  const cycleAccent = (): void => {
    accent = (accent + 1) % ACCENTS.length;
    const value = ACCENTS[accent] ?? ACCENTS[0] ?? '#39FF6A';
    document.documentElement.style.setProperty('--accent', value);
  };

  const onKey = (event: KeyboardEvent): void => {
    // No secuestrar teclas mientras se escribe ni con modificadores
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable]')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const key = event.key.toLowerCase();
    if (key === 'g') toggleGrid();
    else if (key === 'c') cycleAccent();
  };

  document.addEventListener('keydown', onKey);

  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
      grid?.remove();
      grid = null;
      document.documentElement.style.removeProperty('--accent');
    },
  };
}

export function initFooter(): Module {
  const modules = [initClock(), initWordmark(), initHotkeys()];
  return {
    destroy() {
      for (const m of modules) m.destroy();
    },
  };
}
