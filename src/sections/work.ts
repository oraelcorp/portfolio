// src/sections/work.ts — showcase: la pill "VIEW PROJECT" acompaña al cursor y el marcador
// de pestañas cae al proyecto activo (§6.7). Fase 4; reescrito con la referencia medida.
//
// La pill se midió en good-fella (scripts/recon-work.ts → recon/work-behavior.json): es UN
// seguidor `position: fixed` en coordenadas de viewport, que NO se desmonta al salir de la
// figura, con el cartel colgando 32 px por encima del cursor y balanceándose 0.0995° por cada
// píxel de desfase horizontal. Esa arquitectura es además la que arregla el bug de que la pill
// se quedaba pegada al borde: antes vivía dentro de cada figura en coordenadas locales y los
// tweens de opacidad con `overwrite: true` mataban los `quickTo` de posición.

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { isTouch, prefersReducedMotion, type Module } from '../core/utils.ts';

/** Grados de balanceo por píxel de desfase horizontal (ajuste medido: 0.0995, RMS 1.76°). */
const SWING_PER_PX = 0.0995;
/** Tope del balanceo. Lo máximo observado en la referencia fueron 14.1°. */
const SWING_MAX = 16;
/**
 * Margen alrededor de la figura en el que la pill ya viene acompañando al cursor. Con 140 px
 * se veía asomar demasiado lejos del recuadro; 80 px es poco más de media anchura del cartel
 * (111.56 px medidos), así que aparece pegado al borde pero sigue entrando en marcha.
 */
const APPROACH = 80;

/** Cuánto se ensancha el cartel cuando está plegado, al principio y al final del genie. */
const GENIE_SPREAD = 0.38;
/** Estiramiento por píxel de velocidad del seguidor, y su tope. */
const GENIE_PER_PX = 0.006;
const GENIE_MAX = 0.3;
/** Cuánto comprime el eje perpendicular al que se estira. */
const SQUASH_RATIO = 0.6;
/**
 * Retardo del seguimiento, ajustado contra la referencia (mediana 15.8 px, p95 80.9 px con
 * un trayecto idéntico). Con `power3` a 0.5 s salía el doble de flojo: esa curva da un tirón
 * inicial y una cola muy larga, que al re-apuntar cada frame se traduce en mucho arrastre.
 */
const FOLLOW = 0.32;
const FOLLOW_EASE = 'power2';

/** Caída del marcador: duración de un salto de una posición, en segundos. */
const DROP_BASE = 0.5;
/** Altura de referencia de esa caída, en px. El resto escala como un cuerpo cayendo: t ∝ √h. */
const DROP_SPAN = 80;
/** Grados de tumbo por píxel de caída, acotado entre 7° y 20°: un giro sutil, no una voltereta. */
const SPIN_PER_PX = 0.12;

export function initWork(): Module {
  const previews = [...document.querySelectorAll<HTMLElement>('[data-work-preview]')];
  const tabs = [...document.querySelectorAll<HTMLElement>('[data-work-tab]')];
  if (previews.length === 0) return { destroy() {} };

  const modules: Module[] = [];
  const reduced = prefersReducedMotion();

  // ---------------------------------------------------------------- marcador de pestañas
  const marker = document.querySelector<HTMLElement>('[data-work-marker]');
  let setActive = (i: number): void => {
    tabs.forEach((tab, j) => {
      tab.dataset.active = String(i === j);
    });
  };

  if (marker && tabs.length > 0) {
    const slotY = (i: number): number => {
      const slot = tabs[i]?.querySelector<HTMLElement>('.work__slot');
      const wrap = marker.parentElement;
      if (!slot || !wrap) return 0;
      return slot.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
    };
    const slotX = (i: number): number => {
      const slot = tabs[i]?.querySelector<HTMLElement>('.work__slot');
      const wrap = marker.parentElement;
      if (!slot || !wrap) return 0;
      return slot.getBoundingClientRect().left - wrap.getBoundingClientRect().left;
    };

    let current = 0;
    let drop: gsap.core.Timeline | null = null;
    const place = (i: number, animate: boolean): void => {
      const y = slotY(i);
      const x = slotX(i);
      const from = gsap.getProperty(marker, 'y') as number;
      const dist = Math.abs(y - from);

      if (!animate || reduced || dist < 1) {
        drop?.kill();
        gsap.set(marker, { x, y, rotation: 0 });
        return;
      }

      // Caer y rebotar al aterrizar; subir es un salto que se pasa un poco y se asienta.
      // La referencia no anima este marcador (salta): es un diferenciador pedido por Javier.
      const falling = y > from;
      const dur = gsap.utils.clamp(0.35, 0.95, DROP_BASE * Math.sqrt(dist / DROP_SPAN));
      // Un cuadrado que cae tumba un poco sobre su eje y se endereza al posarse. El giro
      // crece con la caída y vuelve a cero con un pequeño rebasamiento al final.
      const spin = (falling ? 1 : -1) * gsap.utils.clamp(7, 20, dist * SPIN_PER_PX);

      drop?.kill();
      drop = gsap
        .timeline()
        .to(marker, { x, y, duration: dur, ease: falling ? 'bounce.out' : 'back.out(1.7)' }, 0)
        .to(marker, { rotation: spin, duration: dur * 0.55, ease: 'power1.in' }, 0)
        .to(marker, { rotation: 0, duration: dur * 0.5, ease: 'back.out(2.2)' }, dur * 0.55);
    };

    marker.dataset.placed = '';
    gsap.set(marker, { x: slotX(0), y: slotY(0) });

    setActive = (i: number): void => {
      tabs.forEach((tab, j) => {
        tab.dataset.active = String(i === j);
      });
      if (i !== current) {
        current = i;
        place(i, true);
      }
    };

    const onResize = (): void => place(current, false);
    window.addEventListener('resize', onResize);
    modules.push({
      destroy() {
        window.removeEventListener('resize', onResize);
        drop?.kill();
        gsap.killTweensOf(marker);
        marker.removeAttribute('data-placed');
        gsap.set(marker, { clearProps: 'all' });
      },
    });
  }

  // --- La pestaña activa sigue al proyecto que se está viendo
  if (tabs.length > 0) {
    const triggers = previews.map((preview, i) =>
      ScrollTrigger.create({
        trigger: preview,
        start: 'top 60%',
        end: 'bottom 40%',
        onToggle: (self) => {
          if (self.isActive) setActive(i);
        },
      }),
    );
    modules.push({
      destroy() {
        for (const t of triggers) t.kill();
      },
    });
  }

  // ---------------------------------------------------------------------------- la pill
  const follower = document.querySelector<HTMLElement>('[data-work-follower]');
  const pill = follower?.querySelector<HTMLElement>('.work__pill') ?? null;

  if (follower && pill && !reduced && !isTouch()) {
    follower.dataset.ready = '';
    // `opacity` y no `autoAlpha`: quickTo no llega a aplicar el atajo de autoAlpha y la pill
    // se quedaba invisible con `visibility: hidden` puesto por el set inicial (medido).
    // Arranca plegada: ancha y sin altura, que es el estado de partida del genie.
    gsap.set(pill, { xPercent: -50, opacity: 0, scaleX: 1 + GENIE_SPREAD, scaleY: 0 });

    const figures = previews
      .map((p) => p.querySelector<HTMLElement>('.work__figure'))
      .filter((f): f is HTMLElement => f !== null);

    const toX = gsap.quickTo(follower, 'x', { duration: FOLLOW, ease: FOLLOW_EASE });
    const toY = gsap.quickTo(follower, 'y', { duration: FOLLOW, ease: FOLLOW_EASE });
    // La posición vive en el seguidor y la apariencia en la pill: eso ya evitaba que un tween
    // matara al otro. Además la pill no lleva tweens en absoluto — se escribe directamente
    // desde el bucle con valores suavizados a mano, así el squash y el giro no pueden pelearse
    // entre sí ni depender del orden en que GSAP los renderice.
    const setAlpha = gsap.quickSetter(pill, 'opacity') as (v: number) => void;
    const setSx = gsap.quickSetter(pill, 'scaleX') as (v: number) => void;
    const setSy = gsap.quickSetter(pill, 'scaleY') as (v: number) => void;
    const setRot = gsap.quickSetter(pill, 'rotation', 'deg') as (v: number) => void;

    let mx = -1;
    let my = -1;
    let seen = false;
    let live = false;

    // Estado suavizado del genie
    let prevX = 0;
    let prevY = 0;
    let vx = 0;
    let vy = 0;
    let unfold = 0;
    let rot = 0;

    /** Distancia del cursor al borde de la figura más cercana. 0 = está dentro. */
    const distanceToFigures = (): number => {
      let best = Infinity;
      for (const f of figures) {
        const r = f.getBoundingClientRect();
        if (r.bottom < -APPROACH || r.top > innerHeight + APPROACH) continue;
        const dx = Math.max(r.left - mx, 0, mx - r.right);
        const dy = Math.max(r.top - my, 0, my - r.bottom);
        best = Math.min(best, Math.hypot(dx, dy));
        if (best === 0) break;
      }
      return best;
    };

    const onMove = (e: PointerEvent): void => {
      mx = e.clientX;
      my = e.clientY;
      if (!seen) {
        // Primera posición conocida: colocar sin viaje, para que no cruce la pantalla.
        seen = true;
        gsap.set(follower, { x: mx, y: my });
      }
    };

    /** Suavizado independiente de los fps: la pantalla puede ir a 48 Hz o a 120. */
    const smooth = (from: number, to: number, tau: number, dt: number): number =>
      from + (to - from) * (1 - Math.exp(-dt / tau));

    const frame = (_t: number, dt: number): void => {
      if (!seen) return;
      toX(mx);
      toY(my);

      const fx = gsap.getProperty(follower, 'x') as number;
      const fy = gsap.getProperty(follower, 'y') as number;

      // Velocidad real del seguidor, en px por frame, suavizada para que no tiemble.
      vx = smooth(vx, fx - prevX, 45, dt);
      vy = smooth(vy, fy - prevY, 45, dt);
      prevX = fx;
      prevY = fy;

      // El cartel se balancea según lo que le falta por alcanzar en horizontal: es lo que
      // hace un objeto colgado del cursor, y es el modelo que ajusta la referencia.
      rot = smooth(rot, gsap.utils.clamp(-SWING_MAX, SWING_MAX, (mx - fx) * SWING_PER_PX), 90, dt);
      setRot(rot);

      // Aparece progresivamente al acercarse, así entra en la figura ya en marcha en vez
      // de materializarse en el borde.
      const target = 1 - gsap.utils.clamp(0, 1, distanceToFigures() / APPROACH);
      unfold = smooth(unfold, target, 110, dt);
      setAlpha(unfold);

      // --- Genie: squash & stretch direccional, no un escalado parejo.
      // 1) Al aparecer y al irse, el cartel se despliega: nace ancho y aplastado contra su
      //    borde inferior (que es su pivote) y se abre hacia arriba, como el efecto del Dock.
      let sx = 1 + GENIE_SPREAD * (1 - unfold);
      let sy = Math.pow(unfold, 0.8);

      // 2) Mientras se mueve, se estira en el eje del movimiento y se comprime en el otro.
      const stretchX = gsap.utils.clamp(0, GENIE_MAX, Math.abs(vx) * GENIE_PER_PX);
      const stretchY = gsap.utils.clamp(0, GENIE_MAX, Math.abs(vy) * GENIE_PER_PX);
      sx *= 1 + stretchX - stretchY * SQUASH_RATIO;
      sy *= 1 + stretchY - stretchX * SQUASH_RATIO;

      setSx(gsap.utils.clamp(0.05, 1.8, sx));
      setSy(gsap.utils.clamp(0, 1.8, sy));
    };

    // Solo mientras el showcase está a la vista: fuera de él no hay nada que seguir.
    const st = ScrollTrigger.create({
      trigger: previews[0]?.closest('[data-section]') ?? previews[0] ?? document.body,
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => {
        if (self.isActive === live) return;
        live = self.isActive;
        if (live) {
          window.addEventListener('pointermove', onMove, { passive: true });
          gsap.ticker.add(frame);
        } else {
          window.removeEventListener('pointermove', onMove);
          gsap.ticker.remove(frame);
          // Fuera del viewport no hay nada que ver: se apaga y se resetea el genie para que
          // la próxima entrada empiece plegada y no desde el estado que quedó a medias.
          unfold = 0;
          vx = 0;
          vy = 0;
          setAlpha(0);
          setSy(0);
        }
      },
    });

    modules.push({
      destroy() {
        st.kill();
        window.removeEventListener('pointermove', onMove);
        gsap.ticker.remove(frame);
        gsap.killTweensOf([follower, pill]);
        follower.removeAttribute('data-ready');
        gsap.set([follower, pill], { clearProps: 'all' });
      },
    });
  }

  return {
    destroy() {
      for (const m of modules) m.destroy();
    },
  };
}
