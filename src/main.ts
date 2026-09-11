// src/main.ts — bootstrap del sitio. Fase 1: estilos + Lenis + anclas.
// El preloader, el nav, el ASCII y las animaciones entran en sus fases (§9).

import './styles/index.css';
import { initLenis, scrollToTarget } from './core/lenis.ts';
import { initDiag } from './core/diag.ts';
import { initPreloader } from './core/preloader.ts';
import { initNav } from './components/Nav.ts';
import { initMenu } from './components/Menu.ts';
import { initCtaButtons } from './components/CtaButton.ts';
import { initMarquee } from './components/Marquee.ts';
import { initCounters } from './components/Counter.ts';
import { initAscii } from './sections/hero.ts';
import { initHeroIntro } from './sections/heroIntro.ts';
import { initReveals } from './sections/reveals.ts';
import { initProcess } from './sections/process.ts';
import { initWork } from './sections/work.ts';
import { initFaq } from './sections/faq.ts';
import { initContact } from './sections/contact.ts';
import { initHovers } from './sections/hovers.ts';
import { initFooter } from './sections/footer.ts';
import type { Module } from './core/utils.ts';

const modules: Module[] = [];

function initAnchors(): Module {
  const onClick = (event: MouseEvent): void => {
    const link = (event.target as HTMLElement | null)?.closest('a[href^="#"]');
    if (!(link instanceof HTMLAnchorElement)) return;

    const id = link.getAttribute('href');
    if (!id || id === '#') return;

    const target = document.querySelector(id);
    if (!target) return;

    event.preventDefault();
    scrollToTarget(target as HTMLElement);
  };

  document.addEventListener('click', onClick);
  return {
    destroy() {
      document.removeEventListener('click', onClick);
    },
  };
}

function boot(): void {
  // El panel de `?diag` se monta APARTE y antes que nada. En `boot()` los argumentos se evalúan
  // todos antes del primer `push`, así que si cualquier `init*` lanza no se registraría ninguno
  // — y el panel es justo lo que hace falta para ver POR QUÉ lanzó, en un teléfono sin depurador.
  try {
    modules.push(initDiag());
  } catch (e) {
    console.error('El panel de diagnóstico no arrancó:', e);
  }

  const preloader = initPreloader();
  modules.push(
    preloader,
    initLenis(),
    initAnchors(),
    initNav(),
    initMenu(),
    initCtaButtons(),
    // El retrato espera a que el preloader salga del todo para su barrido (§6.3 punto 9)
    initAscii(preloader.done),
    // El texto del hero entra ANTES, mientras el overlay se va (§6.1)
    initHeroIntro(preloader.exiting),
    initReveals(),
    initMarquee(),
    initCounters(),
    initProcess(),
    initWork(),
    initFaq(),
    initContact(),
    initHovers(),
    initFooter(),
  );
}

boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const m of modules) m.destroy();
    modules.length = 0;
  });
}
