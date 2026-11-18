// src/sections/process.ts — scrollytelling: el paso activo se enciende, el cubito baja hasta él
// y las medias se APILAN (recon §3, remedido el 2026-09-13 en `scripts/recon-scrolly.ts`).
//
// Dos conductas salen de esa medición sobre la referencia y conviene no "arreglarlas" sin leerla:
//
//   · Las medias NO hacen crossfade. Cada una entra y SE QUEDA: al final las cuatro están a
//     opacidad 1 y se ve la última porque tapa a las anteriores (medido: las cuatro comparten
//     posición y ninguna vuelve a bajar de 1). Es lo que cuenta el contenido — cada paso se
//     construye sobre el anterior, no lo reemplaza.
//   · El cubito gira 90° POR PASO y ACUMULA (0 → 90 → 180 → 270), sin volver nunca a cero, con
//     rebote al aterrizar. Es un giro 2D; la matriz medida no tiene componentes fuera del plano.
//
// El marcador de Work hace otra cosa a propósito (inclinación de 7–20° que se endereza). La
// divergencia es intencional y está razonada en CLAUDE.md: no unificar.

import { gsap, ScrollTrigger } from '../core/gsap.ts';
import { prefersReducedMotion, type Module } from '../core/utils.ts';

/**
 * Suelo de atenuación de los pasos inactivos. Se LEE del CSS (`--process-dim`) para que la
 * media query pueda subirlo en móvil, donde se ven varios pasos a la vez y el 0.32 de
 * escritorio deja el texto por debajo de AA.
 */
function suelo(el: Element): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue('--process-dim'));
  return Number.isFinite(v) ? v : 0.32;
}

/** Grados que suma el cubito en cada paso. Medido en la referencia: 90, y nunca vuelve. */
const GIRO_POR_PASO = 90;

export function initProcess(): Module {
  const steps = [...document.querySelectorAll<HTMLElement>('[data-step]')];
  const media = [...document.querySelectorAll<HTMLElement>('[data-process-media-item]')];
  const marcador = document.querySelector<HTMLElement>('[data-process-marker]');
  if (steps.length === 0) return { destroy() {} };

  // Con reduced motion se muestran todos los pasos por igual, sin atenuar
  if (prefersReducedMotion()) {
    for (const s of steps) s.dataset.active = 'true';
    for (const m of media) m.dataset.active = 'true';
    return { destroy() {} };
  }

  // El cubito se coloca sin animar en el primer paso y se recoloca si cambia el layout: sus
  // coordenadas son relativas a la lista, así que un resize las invalida.
  const recolocar = (): void => colocarMarcador(current < 0 ? 0 : current, false);

  let current = -1;

  const activate = (index: number): void => {
    if (index === current) return;
    current = index;

    steps.forEach((step, i) => {
      const on = i === index;
      step.dataset.active = String(on);
      const dim = suelo(step.closest('.process__body') ?? step);
      gsap.to(step, { autoAlpha: on ? 1 : dim, duration: 0.4, ease: 'main', overwrite: 'auto' });
    });

    // Las medias se APILAN: todas las del paso actual hacia atrás quedan visibles, y el
    // `z-index` por orden hace que la última tape a las anteriores. No es crossfade — eso
    // reemplazaba, y lo que la sección cuenta es acumulación.
    media.forEach((item, i) => {
      const on = i <= index;
      item.dataset.active = String(on);
      item.style.zIndex = String(i + 1);
      gsap.to(item, { autoAlpha: on ? 1 : 0, duration: 0.5, ease: 'main', overwrite: 'auto' });
    });

    colocarMarcador(index);
  };

  /**
   * Lleva el cubito al hueco del paso `index` y le suma 90°.
   *
   * El giro es ACUMULATIVO y no vuelve: comunica progreso lineal. Al caer rebota (`bounce.out`),
   * que es lo que se midió en la referencia — el ángulo rebasa y se reasienta. Subiendo no
   * rebota: un rebote hacia arriba no lo hace ningún objeto y se lee raro.
   */
  function colocarMarcador(index: number, animar = true): void {
    if (!marcador) return;
    const lista = marcador.parentElement;
    const hueco = steps[index]?.querySelector<HTMLElement>('.bullet');
    if (!lista || !hueco) return;

    const r = hueco.getBoundingClientRect();
    const base = lista.getBoundingClientRect();
    const x = r.left - base.left;
    const y = r.top - base.top;
    const giro = index * GIRO_POR_PASO;

    if (!animar) {
      gsap.set(marcador, { x, y, rotation: giro });
      return;
    }

    const desde = (gsap.getProperty(marcador, 'y') as number) ?? y;
    const cayendo = y > desde;
    const dist = Math.abs(y - desde);
    // La duración crece con la distancia pero se acota: un paso largo no puede tardar el doble.
    const dur = gsap.utils.clamp(0.45, 0.95, 0.35 + dist / 900);

    gsap.to(marcador, {
      x,
      y,
      duration: dur,
      ease: cayendo ? 'bounce.out' : 'power2.inOut',
      overwrite: 'auto',
    });
    gsap.to(marcador, {
      rotation: giro,
      duration: dur * 0.8,
      ease: cayendo ? 'power1.in' : 'power2.inOut',
      overwrite: 'auto',
    });
  }

  const triggers = steps.map((step, i) =>
    ScrollTrigger.create({
      trigger: step,
      // El paso manda mientras cruza la banda central del viewport
      start: 'top 65%',
      end: 'bottom 45%',
      onToggle: (self) => {
        if (self.isActive) activate(i);
      },
    }),
  );

  colocarMarcador(0, false);
  activate(0);
  window.addEventListener('resize', recolocar);

  return {
    destroy() {
      for (const t of triggers) t.kill();
      window.removeEventListener('resize', recolocar);
      gsap.killTweensOf([...steps, ...media, ...(marcador ? [marcador] : [])]);
      for (const s of steps) gsap.set(s, { autoAlpha: 1 });
      for (const m of media) m.style.zIndex = '';
      if (marcador) gsap.set(marcador, { clearProps: 'all' });
    },
  };
}
