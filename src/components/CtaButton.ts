// src/components/CtaButton.ts — hover del CTA (§6.5). Fase 4, item 3.
//
// Medido en la referencia con scripts/recon-cta.ts:
//   · NO hay magnetismo: el `transform` del CTA es `none` en reposo, cerca y encima.
//   · El "+" no viaja de un lado a otro. Hay DOS, uno por lado, y se hace el relevo:
//     el visible encoge a scale 0 girando −45° sobre su borde exterior mientras el otro
//     crece de 0 a 1 desde −45°. El label se desliza al hueco. Todo en 0.7 s con
//     cubic-bezier(0.83, 0, 0.17, 1) — eso vive en CSS, no aquí.
//   · El label hace un SCRAMBLE que resuelve de izquierda a derecha (21 estados medidos),
//     sin cambiar de color.
//
// Lo único que necesita JS es el scramble. El barrido que aclara el texto lo pidió Javier
// y va en CSS (`.btn__text`), con la misma duración y curva para que el destello viaje
// pegado al frente de resolución del scramble en vez de ir por su cuenta.

import { gsap } from '../core/gsap.ts';
import { isTouch, prefersReducedMotion, type Module } from '../core/utils.ts';

/** Duración y curva del relevo, en sincronía con --dur-cta / --ease-cta de tokens.css. */
const DURATION = 0.7;
const EASE = 'wipe';

export function initCtaButtons(): Module {
  const groups = [...document.querySelectorAll<HTMLElement>('[data-cta]')];
  // En táctil el scramble se dispararía en el propio toque que navega: ruido justo antes de
  // irse de la página. El relevo del "+" sí se conserva, porque es CSS y responde también a
  // `:focus-within`, así que da respuesta al toque y se deshace al mover el foco.
  if (groups.length === 0 || prefersReducedMotion() || isTouch()) return { destroy() {} };

  const cleanups: Array<() => void> = [];

  for (const group of groups) {
    const text = group.querySelector<HTMLElement>('[data-cta-text]');
    if (!text) continue;

    const label = text.textContent ?? '';
    let tween: gsap.core.Tween | null = null;

    const scramble = (): void => {
      tween?.kill();
      tween = gsap.to(text, {
        duration: DURATION,
        ease: EASE,
        scrambleText: { text: label, chars: 'upperCase', speed: 1, revealDelay: 0 },
      });
    };

    /** Al salir se restituye el texto sin más: volver a scramblear al irse marea. */
    const restore = (): void => {
      tween?.kill();
      tween = null;
      text.textContent = label;
    };

    group.addEventListener('pointerenter', scramble);
    group.addEventListener('pointerleave', restore);
    group.addEventListener('focusin', scramble);
    group.addEventListener('focusout', restore);

    cleanups.push(() => {
      group.removeEventListener('pointerenter', scramble);
      group.removeEventListener('pointerleave', restore);
      group.removeEventListener('focusin', scramble);
      group.removeEventListener('focusout', restore);
      tween?.kill();
      text.textContent = label;
    });
  }

  return {
    destroy() {
      for (const c of cleanups) c();
    },
  };
}
