// src/effects/ascii/debug.ts — panel de ajustes en dev con ?debug (§9 Fase 3). Fase 3.
// Sliders de cellW / contraste / radio del puntero + FPS y ms/frame medidos.

import type { AsciiPortrait } from './AsciiPortrait.ts';
import type { Module } from '../../core/utils.ts';

interface Slider {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  apply: (portrait: AsciiPortrait, value: number) => void;
}

const SLIDERS: Slider[] = [
  // Los `value` reflejan los defaults reales de AsciiPortrait: si divergen, el panel miente
  // sobre lo que se está viendo hasta que se toca el primer slider.
  { label: 'cellW', min: 2, max: 16, step: 0.5, value: 4, apply: (p, v) => p.update({ cellW: v }) },
  { label: 'cellH', min: 2, max: 24, step: 0.5, value: 4, apply: (p, v) => p.update({ cellH: v }) },
  { label: 'fontSize', min: 4, max: 20, step: 1, value: 0, apply: (p, v) => p.update({ fontSize: v }) },
  { label: 'contrast', min: 0.6, max: 3, step: 0.1, value: 1.4, apply: (p, v) => p.update({ contrast: v }) },
  { label: 'smooth', min: 0, max: 4, step: 0.1, value: 0.6, apply: (p, v) => p.update({ smooth: v }) },
  {
    label: 'hlDelta',
    min: 0.05,
    max: 0.6,
    step: 0.01,
    value: 0.11,
    apply: (p, v) => p.update({ highlightDelta: v }),
  },
  { label: 'radius', min: 1, max: 20, step: 1, value: 6, apply: (p, v) => p.update({ pointerRadius: v }) },
];

export function initAsciiDebug(portrait: AsciiPortrait): Module {
  if (!new URLSearchParams(window.location.search).has('debug')) {
    return { destroy() {} };
  }

  // Solo con ?debug: da acceso a la instancia real para los scripts de comparación
  (window as unknown as { __asciiPortrait?: AsciiPortrait }).__asciiPortrait = portrait;

  const panel = document.createElement('div');
  panel.className = 'ascii-debug';
  panel.innerHTML = `<p class="ascii-debug__title">ASCII debug</p><p class="ascii-debug__stats" data-stats>—</p>`;

  for (const s of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'ascii-debug__row';
    row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${s.value}</output>`;

    const input = row.querySelector('input');
    const out = row.querySelector('output');
    input?.addEventListener('input', () => {
      const v = Number(input.value);
      if (out) out.textContent = String(v);
      s.apply(portrait, v);
    });

    panel.append(row);
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ascii-debug__btn';
  toggle.textContent = 'toggle color mode';
  toggle.addEventListener('click', () => portrait.toggleMode());
  panel.append(toggle);

  document.body.append(panel);

  // FPS y ms/frame reales
  const stats = panel.querySelector<HTMLElement>('[data-stats]');
  let frames = 0;
  let last = performance.now();
  let raf = 0;

  const loop = (): void => {
    frames++;
    const now = performance.now();
    if (now - last >= 500) {
      const fps = Math.round((frames * 1000) / (now - last));
      if (stats) {
        stats.textContent = `${fps} fps · ${portrait.lastFrameMs.toFixed(2)} ms/frame · ${portrait.currentMode}`;
      }
      frames = 0;
      last = now;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      panel.remove();
    },
  };
}
