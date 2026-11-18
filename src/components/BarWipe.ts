// src/components/BarWipe.ts — el barrido de dos barras con el que entran los titulares.
//
// NO está reconstruido de una descripción: está MEDIDO sobre la referencia frame a frame con
// `scripts/recon-texto.ts`, muestreando estilos calculados a 60 Hz. El desglose completo está en
// `recon/texto-entrada.txt`. Resumen de lo que hace y por qué:
//
//   · Son DOS divs absolutos sobre cada línea, animados con `scaleX`. No hay pseudo-elementos ni
//     `clip-path` — se comprobó.
//   · Entran desde la IZQUIERDA, desfasados: la barra de acento arranca primero y la del color de
//     fondo la persigue 156 ms por detrás. Ese desfase es lo que se lee como "un destello de
//     acento": es el borde de la primera asomando por delante de la segunda.
//   · A mitad, el `transform-origin` salta de izquierda a DERECHA, así que al retirarse no
//     "vuelven": se van por el otro lado.
//   · Y el detalle que lo sostiene todo: **el texto no hace fade**. Pasa a opacidad 1 de golpe en
//     el único fotograma en que está completamente tapado por la barra. Por eso parece que la
//     barra lo imprime en vez de descubrirlo.
//
// El orden de apilado importa y también sale de la medición: texto < acento < fondo. Al salir,
// la de fondo se retira primero y destapa la de ACENTO (no el texto); la de acento se va después
// y ahí sí aparece el texto.

import { gsap, ScrollTrigger, SplitText } from '../core/gsap.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';

export interface BarWipeOptions {
  /** Si se omite, entra al llegar al 80 % del viewport, como el resto de reveals (§6.7). */
  trigger?: 'scroll' | 'manual';
  /** Retardo entre líneas. NO medido en la referencia: su h2 es de una sola línea. */
  stagger?: number;
  delay?: number;
  /** Escala global del tiempo. 1 = los tiempos medidos tal cual. */
  escala?: number;
}

export interface BarWipeHandle extends Module {
  play(delay?: number): void;
}

/**
 * Tiempos MEDIDOS en la referencia, en segundos. Se dejan como constantes con nombre para que
 * quede claro cuáles salen del dato y cuáles son decisión nuestra.
 */
const T = {
  acentoEntra: 0.076,
  acentoEntraDur: 0.329,
  fondoEntra: 0.232,
  fondoEntraDur: 0.261,
  /** El instante en que el texto se enciende y las barras cambian de origen. */
  giro: 0.493,
  fondoSale: 0.571,
  fondoSaleDur: 0.291,
  acentoSale: 0.676,
  acentoSaleDur: 0.29,
} as const;

/** Eases ajustados contra las curvas reales (error 0.03–0.09 sobre scaleX). */
const EASE_ENTRA_ACENTO = 'power3.inOut';
const EASE_ENTRA_FONDO = 'power1.out';
const EASE_SALE = 'power1.inOut';

interface Linea {
  el: HTMLElement;
  texto: HTMLElement;
  acento: HTMLElement;
  fondo: HTMLElement;
}

function montarLinea(linea: HTMLElement): Linea {
  // El texto pasa a vivir dentro de un span propio para poder encenderlo sin tocar las barras,
  // que son hermanas suyas. Es la misma estructura que usa la referencia.
  const texto = document.createElement('span');
  texto.className = 'barwipe__t';
  while (linea.firstChild) texto.appendChild(linea.firstChild);
  linea.appendChild(texto);

  const barra = (clase: string): HTMLElement => {
    const b = document.createElement('span');
    b.className = `barwipe__b ${clase}`;
    b.setAttribute('aria-hidden', 'true');
    linea.appendChild(b);
    return b;
  };
  // Orden del DOM = orden de apilado: la de fondo va encima de la de acento.
  const acento = barra('barwipe__b--acento');
  const fondo = barra('barwipe__b--fondo');

  linea.classList.add('barwipe__l');
  return { el: linea, texto, acento, fondo };
}

/**
 * Entrada de un titular con el barrido de dos barras. Devuelve un handle para dispararlo a mano
 * (el hero lo necesita: espera a que el preloader arranque su salida).
 */
export function barWipe(el: HTMLElement, options: BarWipeOptions = {}): BarWipeHandle {
  const { trigger = 'scroll', stagger = 0.08, delay = 0, escala = 1 } = options;

  if (prefersReducedMotion()) {
    // §6.14: sin animación, estado final directo y el texto visible.
    gsap.set(el, { autoAlpha: 1 });
    return { play() {}, destroy() {} };
  }

  let split: SplitText | null = null;
  let st: ScrollTrigger | null = null;
  let tl: gsap.core.Timeline | null = null;
  let lineas: Linea[] = [];
  let disparado = trigger === 'scroll';

  const construir = (self: SplitText): gsap.core.Timeline => {
    lineas = (self.lines as HTMLElement[]).map(montarLinea);
    tl?.kill();
    tl = gsap.timeline({ paused: !disparado, delay });

    lineas.forEach((l, i) => {
      const t0 = i * stagger;
      const s = (v: number): number => v * escala;
      gsap.set([l.acento, l.fondo], { scaleX: 0, transformOrigin: 'left center' });
      gsap.set(l.texto, { autoAlpha: 0 });

      tl!
        .to(
          l.acento,
          { scaleX: 1, duration: s(T.acentoEntraDur), ease: EASE_ENTRA_ACENTO },
          t0 + s(T.acentoEntra),
        )
        .to(
          l.fondo,
          { scaleX: 1, duration: s(T.fondoEntraDur), ease: EASE_ENTRA_FONDO },
          t0 + s(T.fondoEntra),
        )
        // El texto se enciende DE GOLPE, tapado. Nada de fade: es lo que hace que la barra
        // parezca imprimirlo. Y en el mismo instante las dos barras cambian de origen.
        .set(l.texto, { autoAlpha: 1 }, t0 + s(T.giro))
        .set([l.acento, l.fondo], { transformOrigin: 'right center' }, t0 + s(T.giro))
        .to(l.fondo, { scaleX: 0, duration: s(T.fondoSaleDur), ease: EASE_SALE }, t0 + s(T.fondoSale))
        .to(l.acento, { scaleX: 0, duration: s(T.acentoSaleDur), ease: EASE_SALE }, t0 + s(T.acentoSale));
    });

    return tl;
  };

  split = SplitText.create(el, {
    type: 'lines',
    autoSplit: true,
    aria: 'auto',
    onSplit(self) {
      const t = construir(self);
      if (trigger === 'scroll') {
        st?.kill();
        st = ScrollTrigger.create({ trigger: el, start: 'top 80%', once: true, animation: t });
      }
      return t;
    },
  });

  return {
    play(extra = 0) {
      disparado = true;
      if (!tl) return;
      tl.delay(delay + extra);
      tl.restart(true);
    },
    destroy() {
      st?.kill();
      st = null;
      tl?.kill();
      tl = null;
      split?.revert();
      split = null;
      lineas = [];
    },
  };
}
