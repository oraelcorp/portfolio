// src/components/Nav.ts — barra fija transparente que invierte su color según la sección de debajo. Fase 2.
// Del recon se conserva: fondo transparente + color por sección (así es la referencia).
// DIFERENCIADORES INTENCIONALES de Javier (la referencia NO los hace, medido en recon/nav-behavior.json):
// encogimiento a partir de 80 px y auto-hide/reaparición según la dirección del scroll (§6.2 original).

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';

/** Punto del nav que decide el tema: su línea media. */
const NAV_MIDLINE = 48;
/** A partir de aquí la barra encoge (§6.2). */
const SHRINK_AT = 80;
/** Y a partir de aquí puede ocultarse al bajar (deja pasar el hero sin parpadeos). */
const HIDE_AFTER = 240;

function initThemeSync(nav: HTMLElement): Module {
  const triggers = [...document.querySelectorAll<HTMLElement>('[data-section]')].map((section) =>
    ScrollTrigger.create({
      trigger: section,
      start: `top top+=${NAV_MIDLINE}`,
      end: `bottom top+=${NAV_MIDLINE}`,
      onToggle: (self) => {
        if (self.isActive) nav.dataset.theme = section.dataset.theme ?? 'dark';
      },
    }),
  );

  return {
    destroy() {
      for (const t of triggers) t.kill();
    },
  };
}

/**
 * Encogimiento a los 80 px y auto-hide por dirección de scroll (§6.2).
 * El nav nunca se esconde con el menú abierto: dejaría el botón CLOSE fuera de alcance.
 */
function initScrollBehavior(nav: HTMLElement): Module {
  if (prefersReducedMotion()) return { destroy() {} };

  const toggle = document.querySelector<HTMLElement>('[data-menu-toggle]');
  const setY = gsap.quickTo(nav, 'yPercent', { duration: 0.45, ease: 'main' });
  let hidden = false;

  const trigger = ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      const y = self.scroll();
      nav.dataset.scrolled = String(y > SHRINK_AT);

      const menuOpen = toggle?.getAttribute('aria-expanded') === 'true';
      const shouldHide = !menuOpen && self.direction === 1 && y > HIDE_AFTER;

      if (shouldHide !== hidden) {
        hidden = shouldHide;
        setY(hidden ? -100 : 0);
      }
    },
  });

  return {
    destroy() {
      trigger.kill();
      gsap.killTweensOf(nav);
      gsap.set(nav, { yPercent: 0 });
      delete nav.dataset.scrolled;
    },
  };
}

export function initNav(): Module {
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  if (!nav) return { destroy() {} };

  const modules: Module[] = [initThemeSync(nav), initScrollBehavior(nav)];

  return {
    destroy() {
      for (const m of modules) m.destroy();
    },
  };
}
