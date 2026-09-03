// src/components/Menu.ts — panel desplegable bajo el nav (recon: NO es overlay fullscreen). Fase 2.
// Incluye swap del wordmark (JAVIER → TRAPERO), MENU ↔ CLOSE con scramble, Esc, foco atrapado
// y lenis.stop()/start() mientras está abierto (§6.2).

import { gsap } from '../core/gsap.ts';
import { getLenis } from '../core/lenis.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';
import { site } from '../content/site.ts';

const FOCUSABLE = 'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';
const SCRAMBLE_CHARS = 'upperCase';

export function initMenu(): Module {
  const panel = document.querySelector<HTMLElement>('[data-menu]');
  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const label = document.querySelector<HTMLElement>('[data-menu-label]');
  const logo = document.querySelector<HTMLElement>('[data-logo]');
  const backdrop = document.querySelector<HTMLElement>('[data-menu-backdrop]');

  if (!panel || !toggle || !label) return { destroy() {} };

  const links = [...panel.querySelectorAll<HTMLElement>('[data-menu-link]')];
  const cols = [...panel.querySelectorAll<HTMLElement>('[data-menu-col]')];
  const reduced = prefersReducedMotion();
  let open = false;
  let tl: gsap.core.Timeline | null = null;

  const setLabel = (text: string): void => {
    if (reduced) {
      label.textContent = text;
      return;
    }
    gsap.to(label, {
      duration: 0.4,
      ease: 'none',
      scrambleText: { text, chars: SCRAMBLE_CHARS, speed: 1, revealDelay: 0.1 },
    });
  };

  const setLogo = (text: string): void => {
    if (!logo) return;
    if (reduced) {
      logo.textContent = text;
      return;
    }
    gsap.to(logo, {
      duration: 0.4,
      ease: 'none',
      scrambleText: { text, chars: SCRAMBLE_CHARS, speed: 1, revealDelay: 0.1 },
    });
  };

  // Arrow functions (no declaraciones): así TS conserva el estrechamiento de los const de arriba.
  const show = (): void => {
    open = true;
    panel.dataset.open = 'true';
    panel.removeAttribute('inert');
    toggle.setAttribute('aria-expanded', 'true');
    getLenis()?.stop();
    setLabel(site.nav.closeLabel);
    setLogo(site.nav.logoAlt);

    tl?.kill();

    if (reduced) {
      gsap.set(panel, { clipPath: 'inset(0 0 0 0)' });
      gsap.set([...links, ...cols], { yPercent: 0, opacity: 1 });
      if (backdrop) gsap.set(backdrop, { autoAlpha: 1 });
    } else {
      tl = gsap.timeline();
      if (backdrop) tl.to(backdrop, { autoAlpha: 1, duration: 0.4, ease: 'none' }, 0);
      tl.fromTo(
        panel,
        { clipPath: 'inset(0 0 100% 0)' },
        { clipPath: 'inset(0 0 0% 0)', duration: 0.8, ease: 'wipe' },
        0,
      )
        .fromTo(links, { yPercent: 100 }, { yPercent: 0, duration: 0.7, ease: 'main', stagger: 0.06 }, 0.25)
        .fromTo(cols, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'none', stagger: 0.08 }, 0.35);
    }

    links[0]?.focus({ preventScroll: true });
  };

  const hide = (returnFocus = true): void => {
    open = false;
    toggle.setAttribute('aria-expanded', 'false');
    setLabel(site.nav.menuLabel);
    setLogo(site.nav.logo);

    tl?.kill();

    const finish = (): void => {
      panel.dataset.open = 'false';
      panel.setAttribute('inert', '');
      getLenis()?.start();
      if (returnFocus) toggle.focus({ preventScroll: true });
    };

    if (reduced) {
      if (backdrop) gsap.set(backdrop, { autoAlpha: 0 });
      finish();
      return;
    }

    tl = gsap.timeline({ onComplete: finish });
    tl.to(panel, { clipPath: 'inset(0 0 100% 0)', duration: 0.6, ease: 'wipe' }, 0);
    if (backdrop) tl.to(backdrop, { autoAlpha: 0, duration: 0.4, ease: 'none' }, 0);
  };

  const onToggle = (): void => {
    if (open) hide();
    else show();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (!open) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      hide();
      return;
    }

    // Foco atrapado dentro del panel mientras está abierto (§8)
    if (event.key === 'Tab') {
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  // Un enlace del menú navega y cierra
  const onPanelClick = (event: MouseEvent): void => {
    const link = (event.target as HTMLElement | null)?.closest('a[href^="#"]');
    if (link) hide(false);
  };

  const onBackdropClick = (): void => {
    if (open) hide();
  };

  toggle.addEventListener('click', onToggle);
  document.addEventListener('keydown', onKeydown);
  panel.addEventListener('click', onPanelClick);
  backdrop?.addEventListener('click', onBackdropClick);

  // Estado cerrado inicial: fuera del orden de tabulación
  panel.setAttribute('inert', '');

  return {
    destroy() {
      tl?.kill();
      toggle.removeEventListener('click', onToggle);
      document.removeEventListener('keydown', onKeydown);
      panel.removeEventListener('click', onPanelClick);
      backdrop?.removeEventListener('click', onBackdropClick);
      getLenis()?.start();
    },
  };
}
