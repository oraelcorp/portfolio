// src/sections/hero.ts — monta el retrato ASCII del hero y el del footer. Fase 3.

import { AsciiPortrait } from '../effects/ascii/AsciiPortrait.ts';
import { initAsciiDebug } from '../effects/ascii/debug.ts';
import { site } from '../content/site.ts';
import type { Module } from '../core/utils.ts';

const SRC = '/img/portrait/portrait.png';

/** `ready` es la salida del preloader: el reveal por scanline arranca ahí (§6.3 punto 8). */
export function initAscii(ready: Promise<void>): Module {
  const modules: Module[] = [];
  const heroCanvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');

  if (heroCanvas) {
    // El canvas no es enfocable: el botón da acceso por teclado al modo color (§8)
    const toggle = document.querySelector<HTMLButtonElement>('[data-ascii-toggle]');

    const portrait = new AsciiPortrait(heroCanvas, {
      src: SRC,
      interactive: true,
      // El indicador se sincroniza venga el cambio del canvas o del botón
      onModeChange: (mode) => {
        if (toggle) toggle.textContent = mode === 'color' ? site.hero.asciiHintBack : site.hero.asciiHint;
      },
    });
    modules.push(portrait, initAsciiDebug(portrait));

    void ready.then(() => portrait.reveal());

    if (toggle) {
      const onClick = (): void => portrait.toggleMode();
      toggle.addEventListener('click', onClick);
      modules.push({
        destroy() {
          toggle.removeEventListener('click', onClick);
        },
      });
    }
  }

  // Segunda instancia: el jaguar asomando en el footer (decisión aprobada en diff.md §B1)
  const footerCanvas = document.querySelector<HTMLCanvasElement>('[data-ascii-footer]');
  if (footerCanvas) {
    modules.push(new AsciiPortrait(footerCanvas, { src: SRC, interactive: false, cellW: 7, cellH: 10 }));
  }

  return {
    destroy() {
      for (const m of modules) m.destroy();
    },
  };
}
