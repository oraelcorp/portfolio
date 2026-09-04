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
/** Margen alrededor de la figura en el que la pill ya viene acompañando al cursor. */
const APPROACH = 140;
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
    const place = (i: number, animate: boolean): void => {
      const y = slotY(i);
      const x = slotX(i);
      const from = gsap.getProperty(marker, 'y') as number;
      const dist = Math.abs(y - from);

      if (!animate || reduced || dist < 1) {
        gsap.set(marker, { x, y });
        return;
      }

      // Caer y rebotar al aterrizar; subir es un salto que se pasa un poco y se asienta.
      // La referencia no anima este marcador (salta): es un diferenciador pedido por Javier.
      const falling = y > from;
      gsap.to(marker, {
        x,
        y,
        duration: gsap.utils.clamp(0.35, 0.95, DROP_BASE * Math.sqrt(dist / DROP_SPAN)),
        ease: falling ? 'bounce.out' : 'back.out(1.7)',
        overwrite: 'auto',
      });
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
    gsap.set(pill, { xPercent: -50, opacity: 0, scale: 0.6 });

    const figures = previews
      .map((p) => p.querySelector<HTMLElement>('.work__figure'))
      .filter((f): f is HTMLElement => f !== null);

    const toX = gsap.quickTo(follower, 'x', { duration: FOLLOW, ease: FOLLOW_EASE });
    const toY = gsap.quickTo(follower, 'y', { duration: FOLLOW, ease: FOLLOW_EASE });
    // Apariencia y giro viven en la pill, la posición en el seguidor: así ningún tween de
    // los unos puede matar a los otros, que era justo la causa de que se quedara pegada.
    const toAlpha = gsap.quickTo(pill, 'opacity', { duration: 0.3, ease: 'power2' });
    const toScale = gsap.quickTo(pill, 'scale', { duration: 0.4, ease: 'power2' });
    const toRot = gsap.quickTo(pill, 'rotation', { duration: 0.45, ease: 'power2' });

    let mx = -1;
    let my = -1;
    let seen = false;
    let live = false;

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

    const frame = (): void => {
      if (!seen) return;
      toX(mx);
      toY(my);

      // El cartel se balancea según lo que le falta por alcanzar en horizontal: es lo que
      // hace un objeto colgado del cursor, y es el modelo que ajusta la referencia.
      const fx = gsap.getProperty(follower, 'x') as number;
      toRot(gsap.utils.clamp(-SWING_MAX, SWING_MAX, (mx - fx) * SWING_PER_PX));

      // Aparece progresivamente al acercarse, así entra en la figura ya en marcha en vez
      // de materializarse en el borde.
      const t = 1 - gsap.utils.clamp(0, 1, distanceToFigures() / APPROACH);
      toAlpha(t);
      toScale(0.6 + 0.4 * t);
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
          toAlpha(0);
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
