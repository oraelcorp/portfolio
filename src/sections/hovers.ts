// src/sections/hovers.ts — scramble al pasar el cursor: principios, stack y, desde el
// 2026-09-11, los proyectos de la sección Work.
// Es el mismo recurso que usa la referencia en su rejilla "THE BUILD" (recon §5). Fase 4.
//
// OJO con el alcance: aquí NO hay un componente de scramble compartido. Cada sitio del proyecto
// llama a `scrambleText` de GSAP con SUS propias opciones —menú, FAQ, footer, CTA y este—, así
// que tocar los parámetros de uno no arrastra a los demás. Por eso el bloque de Work puede tener
// su propia duración sin que haya que revisar los otros cuatro.

import { gsap } from '../core/gsap.ts';
import { prefersReducedMotion, isTouch, type Module } from '../core/utils.ts';

const SELECTOR = '.principles__title, .stack__name';
/** Los proyectos: el título va dentro de `.work__meta`, junto a su línea de metadatos. */
const WORK = '[data-work-preview]';

/**
 * Parámetros del scramble de los proyectos.
 *
 * Son los MISMOS que usan principios y stack, a propósito: la referencia no pudo medirse —su
 * efecto no se dispara bajo automatización, comprobado por muestreo de estilos (78 muestras sin
 * un solo cambio) y por vídeo a cámara lenta (15 fotogramas con el puntero encima y el texto
 * intacto)—, así que en vez de inventarse unos números se reutiliza el comportamiento que ya
 * está aprobado en el sitio. Si algún día se mide, esto es lo que hay que cambiar.
 */
const SCRAMBLE = { duration: 0.5, chars: 'upperCase', speed: 1.4, revealDelay: 0.05 } as const;

export function initHovers(): Module {
  if (prefersReducedMotion() || isTouch()) return { destroy() {} };

  const targets = [...document.querySelectorAll<HTMLElement>(SELECTOR)];
  const cleanups: Array<() => void> = [];

  for (const el of targets) {
    // El texto vive junto a un <i class="bullet">, así que se scramblea solo el nodo de texto
    const textNode = [...el.childNodes].find(
      (n): n is Text => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
    );
    if (!textNode) continue;

    const original = textNode.textContent ?? '';

    // scrambleText necesita un elemento, no un nodo de texto suelto
    const span = document.createElement('span');
    span.textContent = original;
    textNode.replaceWith(span);

    const onEnter = (): void => {
      gsap.to(span, {
        duration: 0.5,
        ease: 'none',
        scrambleText: { text: original, chars: 'upperCase', speed: 1.4, revealDelay: 0.05 },
        overwrite: true,
      });
    };

    el.addEventListener('pointerenter', onEnter);
    cleanups.push(() => {
      el.removeEventListener('pointerenter', onEnter);
      gsap.killTweensOf(span);
      span.textContent = original;
    });
  }

  // ---------------------------------------------------------------- proyectos (Work)
  for (const art of document.querySelectorAll<HTMLElement>(WORK)) {
    const titulo = art.querySelector<HTMLElement>('.work__meta h3');
    if (!titulo) continue;
    const original = titulo.textContent ?? '';

    // El marcador se crea aquí y no en el marcado: es decoración de hover, no contenido, y sin
    // JS (o con reduced-motion) no tiene por qué existir.
    const cubo = document.createElement('i');
    cubo.className = 'work__cube';
    cubo.setAttribute('aria-hidden', 'true');
    titulo.prepend(cubo);

    // El texto se envuelve para poder barajarlo sin tocar el cubo, que es hermano suyo.
    const span = document.createElement('span');
    span.textContent = original;
    for (const n of [...titulo.childNodes]) if (n.nodeType === Node.TEXT_NODE) n.remove();
    titulo.appendChild(span);

    const onEnter = (): void => {
      // GUARDA: si ya está barajando, no se reinicia. Sin esto el efecto no resolvía nunca —
      // medido en vídeo: 5 segundos de letras aleatorias sin llegar al título. La tarjeta se
      // transforma al entrar (la etiqueta "VIEW PROJECT"), el puntero queda fuera un frame y
      // vuelve a entrar, y cada entrada relanzaba el tween desde cero.
      if (gsap.isTweening(span)) return;
      gsap.to(span, {
        duration: SCRAMBLE.duration,
        ease: 'none',
        scrambleText: {
          text: original,
          chars: SCRAMBLE.chars,
          speed: SCRAMBLE.speed,
          revealDelay: SCRAMBLE.revealDelay,
        },
        overwrite: true,
      });
      gsap.to(cubo, { scale: 1, rotate: 0, duration: 0.32, ease: 'back.out(2)', overwrite: true });
    };
    const onLeave = (): void => {
      // El texto no se vuelve a barajar al salir —marea— pero el cubo sí se retira.
      gsap.to(cubo, { scale: 0, rotate: -45, duration: 0.22, ease: 'power2.in', overwrite: true });
    };

    // Se escucha en el BLOQUE DE TEXTO, no en la tarjeta entera: la tarjeta se transforma al
    // entrar y eso hacía que el puntero entrara y saliera en bucle.
    const zona = titulo.closest<HTMLElement>('.work__meta') ?? titulo;
    zona.addEventListener('pointerenter', onEnter);
    zona.addEventListener('pointerleave', onLeave);
    zona.addEventListener('focusin', onEnter);
    zona.addEventListener('focusout', onLeave);
    cleanups.push(() => {
      zona.removeEventListener('pointerenter', onEnter);
      zona.removeEventListener('pointerleave', onLeave);
      zona.removeEventListener('focusin', onEnter);
      zona.removeEventListener('focusout', onLeave);
      gsap.killTweensOf([span, cubo]);
      span.textContent = original;
      cubo.remove();
    });
  }

  return {
    destroy() {
      for (const c of cleanups) c();
    },
  };
}
