// src/sections/work.ts — showcase: la pill "VIEW PROJECT" acompaña al cursor y el marcador
// de pestañas cae al proyecto activo (§6.7). Fase 4; reescrito con la referencia medida.
//
// La pill se midió en good-fella (scripts/recon-work.ts y recon-pill-box.ts): es UN seguidor
// `position: fixed` en coordenadas de viewport, que NO se desmonta al salir de la figura, con
// el cartel de 111.56 × 28.6 px colgando 11.4 px por encima del cursor y balanceándose 0.0995°
// por cada píxel de desfase horizontal. Esa arquitectura es además la que arregla el bug de que
// la pill se quedaba pegada al borde: antes vivía dentro de cada figura en coordenadas locales
// y los tweens de opacidad con `overwrite: true` mataban los `quickTo` de posición.

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { isTouch, prefersReducedMotion, type Module } from '../core/utils.ts';

/** Parte lineal de una transformación 2D, en el orden de `matrix(a, b, c, d, …)` de CSS. */
interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
}

const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1 };

/**
 * Estira `along` a lo largo de un eje girado `angle` y `perp` en su perpendicular: R·S·Rᵀ.
 * Es una escala anisótropa sobre un eje ARBITRARIO, que es lo que `scaleX`/`scaleY` no saben
 * hacer sin dejar el elemento girado. La matriz sale simétrica, así que no introduce rotación.
 */
function axisScale(angle: number, along: number, perp: number): Mat {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cc = c * c;
  const ss = s * s;
  const cross = (along - perp) * s * c;
  return { a: along * cc + perp * ss, b: cross, c: cross, d: along * ss + perp * cc };
}

/** Rotación pura, en el mismo formato. */
function rotation(angle: number): Mat {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { a: c, b: s, c: -s, d: c };
}

/** Producto de dos matrices en convención CSS: [[a, c], [b, d]]. */
function mul(m: Mat, n: Mat): Mat {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
  };
}

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

/** Cuánto se alarga el cartel a lo largo de su eje cuando está plegado. */
const GENIE_SPREAD = 0.38;
/** Estiramiento por píxel de velocidad del seguidor, y su tope. */
const GENIE_PER_PX = 0.006;
const GENIE_MAX = 0.3;
/** Cuánto comprime el eje perpendicular al que se estira. */
const SQUASH_RATIO = 0.6;
/** Desplazamiento mínimo, en px, para que el eje del genie tenga una dirección con sentido. */
const AXIS_MIN = 10;
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
    // El transform de la pill se escribe entero a mano, sin pasar por GSAP: el genie es una
    // matriz completa (escala sobre un eje arbitrario) y `scaleX`/`scaleY` no pueden
    // expresarla sin dejar el cartel girado. Mezclar escrituras crudas con la caché de
    // transformaciones de GSAP sobre el mismo elemento daría resultados según quién escriba
    // último, así que aquí GSAP no toca la pill: solo el seguidor.
    const paint = (m: Mat, alpha: number): void => {
      pill.style.opacity = alpha.toFixed(3);
      pill.style.transform =
        `translate(-50%, 0px) matrix(${m.a.toFixed(4)}, ${m.b.toFixed(4)}, ` +
        `${m.c.toFixed(4)}, ${m.d.toFixed(4)}, 0, 0)`;
    };
    paint(axisScale(0, 1 + GENIE_SPREAD, 0), 0);

    const figures = previews
      .map((p) => p.querySelector<HTMLElement>('.work__figure'))
      .filter((f): f is HTMLElement => f !== null);

    const toX = gsap.quickTo(follower, 'x', { duration: FOLLOW, ease: FOLLOW_EASE });
    const toY = gsap.quickTo(follower, 'y', { duration: FOLLOW, ease: FOLLOW_EASE });
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
    /** Punto desde el que el cartel se despliega: la última posición en la que estuvo plegado. */
    let foldX = 0;
    let foldY = 0;
    /** Eje del despliegue, como vector unitario suavizado. Arranca horizontal. */
    let axisX = 1;
    let axisY = 0;
    /** Si el eje ya se ha tomado en este despliegue. Ver la nota en el bucle. */
    let axisSet = false;

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

      // Aparece progresivamente al acercarse, así entra en la figura ya en marcha en vez
      // de materializarse en el borde.
      const target = 1 - gsap.utils.clamp(0, 1, distanceToFigures() / APPROACH);
      unfold = smooth(unfold, target, 110, dt);

      // Mientras está plegado, el origen del genie es el propio cursor: así, en cuanto empieza
      // a desplegarse, el vector origen→cursor apunta por donde ha venido.
      if (unfold < 0.02) {
        foldX = mx;
        foldY = my;
        axisSet = false;
      }

      // --- Genie: la MISMA escala direccional para las dos fases, en dos ejes distintos.
      //
      // 1) Despliegue. El eje no es fijo: es el vector desde el punto en el que el cartel
      //    estaba plegado hasta donde está el cursor ahora. Plegado, el cartel es una cinta
      //    fina TENDIDA A LO LARGO de ese vector, y se abre en su perpendicular — igual que
      //    una ventana estirándose hacia el icono del Dock, venga de donde venga.
      const ox = mx - foldX;
      const oy = my - foldY;
      const olen = Math.hypot(ox, oy);
      if (olen > AXIS_MIN) {
        const nx = ox / olen;
        const ny = oy / olen;
        if (!axisSet) {
          // Primer eje de este despliegue: se toma tal cual. Suavizarlo desde el del pase
          // anterior hacía que un acercamiento vertical saliera en diagonal, porque el eje
          // seguía girando desde donde lo dejó la salida anterior y el despliegue dura menos
          // de lo que tarda en converger. Plegado no hay nada en pantalla que continuar.
          axisX = nx;
          axisY = ny;
          axisSet = true;
        } else {
          // Ya desplegándose: se suaviza el vector, no el ángulo, para no saltar en ±180°.
          axisX = smooth(axisX, nx, 130, dt);
          axisY = smooth(axisY, ny, 130, dt);
          const n = Math.hypot(axisX, axisY) || 1;
          axisX /= n;
          axisY /= n;
        }
      }
      const unfoldM = axisScale(
        Math.atan2(axisY, axisX),
        1 + GENIE_SPREAD * (1 - unfold),
        Math.pow(unfold, 0.8),
      );

      // 2) Movimiento. Mismo cálculo, con el eje de la velocidad. Antes se hacía por
      //    componentes X/Y, que en una diagonal se cancelaban entre sí.
      const vlen = Math.hypot(vx, vy);
      const stretch = gsap.utils.clamp(0, GENIE_MAX, vlen * GENIE_PER_PX);
      const velM =
        vlen > 0.5 ? axisScale(Math.atan2(vy, vx), 1 + stretch, 1 - stretch * SQUASH_RATIO) : IDENTITY;

      // El balanceo va por fuera: deforma primero y el conjunto entero se columpia.
      paint(mul(rotation((rot * Math.PI) / 180), mul(unfoldM, velM)), unfold);
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
          axisX = 1;
          axisY = 0;
          axisSet = false;
          paint(axisScale(0, 1 + GENIE_SPREAD, 0), 0);
        }
      },
    });

    modules.push({
      destroy() {
        st.kill();
        window.removeEventListener('pointermove', onMove);
        gsap.ticker.remove(frame);
        gsap.killTweensOf(follower);
        follower.removeAttribute('data-ready');
        gsap.set(follower, { clearProps: 'all' });
        // La pill no la gestiona GSAP: se limpian sus estilos en línea a mano.
        pill.style.removeProperty('transform');
        pill.style.removeProperty('opacity');
      },
    });
  }

  return {
    destroy() {
      for (const m of modules) m.destroy();
    },
  };
}
