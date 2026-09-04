// src/core/preloader.ts — overlay de acento con los cuatro cuadrados que vuelcan + "LOADING"
// y salida en wipe horizontal. Fase 2; indicador remedido frame a frame en la Fase 4.
// La referencia NO usa contador 000→100 (diff.md §B2) ni bloques que se rellenan: cada cuadrado
// gira 90° sobre su esquina inferior derecha hasta llenar la pista (§6.1, recon/spinner.json).

import { gsap } from './gsap.ts';
import { prefersReducedMotion, type Module } from './utils.ts';

const SESSION_KEY = 'javier:preloaded';

/** Medidas del indicador, tomadas de la referencia (§6.1). */
const BLOCK = 16; // px — lado del cuadrado; el vuelco lo desplaza justo esto
const STEP = 18; // px — hueco entre huecos: 16 de bloque + 2 de aire
const TUMBLE = 0.49; // s — duración de un vuelco de 90°
const STAGGER = 0.52; // s — cada cuánto arranca el siguiente
const SCRAMBLE = 0.7; // s — lo que tarda "LOADING" en resolverse
/**
 * El scramble no arranca a la vez que el primer vuelco: justo ahí el hilo principal está
 * ocupado terminando de cargar, y como `lagSmoothing(0)` hace que GSAP avance el tiempo real
 * perdido, el efecto se consumía en un salto. Medido: 4 estados visibles en vez de ~20.
 */
const SCRAMBLE_AT = 0.35; // s
/** Mismo repertorio que la rampa del retrato ASCII, para que la textura sea la del sitio. */
const SCRAMBLE_CHARS = '#%@8&0OZXYUJCLQ+-~:;/\\|1379ABDEF';

/** Lo que dura la secuencia completa: el overlay no se va antes de terminarla. */
const SEQUENCE = STAGGER * 3 + TUMBLE;

/** Espera a que las fuentes y la imagen del retrato estén listas (sin bloquear si fallan). */
async function assetsReady(): Promise<void> {
  const fonts = document.fonts.ready.catch(() => undefined);

  const portrait = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // aún no existe el asset: no bloquear (§7)
    img.src = '/img/portrait/portrait.png';
  });

  await Promise.all([fonts, portrait]);
}

export interface Preloader extends Module {
  /** Resuelve cuando el overlay ARRANCA su salida: aquí entra el hero, por debajo (§6.1). */
  readonly exiting: Promise<void>;
  /** Resuelve cuando el overlay ya se ha ido: aquí arranca el barrido del retrato (§6.3). */
  readonly done: Promise<void>;
}

export function initPreloader(): Preloader {
  const el = document.querySelector<HTMLElement>('[data-preloader]');

  if (!el) {
    return { exiting: Promise.resolve(), done: Promise.resolve(), destroy() {} };
  }

  // Solo la primera visita de la sesión (§6.1)
  if (sessionStorage.getItem(SESSION_KEY) === '1') {
    el.remove();
    return { exiting: Promise.resolve(), done: Promise.resolve(), destroy() {} };
  }

  // Se avisa en cuanto empieza el wipe, para que el hero entre por debajo mientras se va
  let startExit = (): void => {};
  const exiting = new Promise<void>((resolve) => {
    startExit = resolve;
  });

  // El overlay ya viene visible del HTML (ver el script en línea de index.html): aquí solo
  // se marca que la carga está en curso, para el CSS que congela el scroll de fondo.
  document.documentElement.dataset.loading = 'true';

  const reduced = prefersReducedMotion();
  const blocks = [...el.querySelectorAll<HTMLElement>('[data-block]')];
  const label = el.querySelector<HTMLElement>('[data-loading-label]');
  let tl: gsap.core.Timeline | null = null;

  const done = (async (): Promise<void> => {
    const started = performance.now();

    if (reduced) {
      // Estado final directo: la pista llena, sin vuelcos ni scramble.
      gsap.set(blocks, { rotate: 90, x: (i: number) => STEP * i - BLOCK });
      if (label) {
        label.textContent = 'LOADING';
        label.dataset.resolved = '';
      }
    } else {
      // Los cuatro cuadrados entran volcando desde fuera del borde izquierdo, uno tras otro.
      // El giro de 90° sobre la esquina inferior derecha ya empuja el bloque 16px; la x lo
      // lleva el resto del camino hasta su hueco (§6.1).
      tl = gsap.timeline();
      tl.to(blocks, {
        rotate: 90,
        x: (i: number) => STEP * i - BLOCK,
        duration: TUMBLE,
        ease: 'power3.inOut',
        stagger: STAGGER,
      });

      if (label) {
        tl.to(
          label,
          {
            duration: SCRAMBLE,
            ease: 'none',
            // `speed` por defecto: con 0.6 la cola apenas cambiaba y salían 6 estados frente
            // a los ~20 de la referencia. El juego de caracteres sale de la rampa del retrato
            // ASCII, para que la textura del scramble sea la misma del resto del sitio.
            scrambleText: { text: 'LOADING', chars: SCRAMBLE_CHARS, newClass: 'is-set' },
            // El plugin deshace el envoltorio .is-set al acabar, así que el estado final
            // necesita su propia marca o el texto se queda tenue para siempre.
            onComplete: () => {
              label.dataset.resolved = '';
            },
          },
          SCRAMBLE_AT,
        );
      }
    }

    await assetsReady();

    // El overlay nunca se va a media secuencia: espera a que los cuatro hayan aterrizado.
    const floor = reduced ? 0.3 : SEQUENCE;
    const elapsed = (performance.now() - started) / 1000;
    if (elapsed < floor) {
      await new Promise((r) => setTimeout(r, (floor - elapsed) * 1000));
    }

    tl?.kill();
    tl = null;

    sessionStorage.setItem(SESSION_KEY, '1');
    document.documentElement.dataset.loading = 'false';

    // A partir de aquí el hero puede entrar: lo hará por debajo del overlay que se va (§6.1)
    startExit();

    if (reduced) {
      await gsap.to(el, { autoAlpha: 0, duration: 0.3, ease: 'none' });
    } else {
      // Wipe horizontal: el overlay se va hacia la derecha con el borde ligeramente inclinado
      await gsap.to(el, { xPercent: 100, skewX: -3, duration: 1, ease: 'wipe' });
    }

    el.remove();
  })();

  return {
    exiting,
    done,
    destroy() {
      tl?.kill();
      gsap.killTweensOf(el);
      el.remove();
      document.documentElement.dataset.loading = 'false';
    },
  };
}
