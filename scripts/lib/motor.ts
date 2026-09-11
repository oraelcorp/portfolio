// scripts/lib/motor.ts — la forma de los motores del retrato TAL Y COMO LA VEN LAS SONDAS.
//
// Existe para que las sondas no tengan que escribir `(window as any).__asciiGL` una y otra vez.
// §3 del proyecto prohíbe `any`, y saltárselo con un `eslint-disable` en cada sonda es la misma
// clase de deuda que el helper del puntero: funciona hasta que alguien lo copia mal. Aquí se
// declara UNA vez lo que las sondas necesitan ver, y se acabó.
//
// Son tipos, así que desaparecen al compilar: se pueden usar dentro de `page.evaluate` sin que
// llegue nada de esto al navegador.

/** Lo que expone `AsciiPortraitGL` en `window.__asciiGL` para las sondas. */
export interface MotorGL {
  source: HTMLVideoElement | HTMLImageElement;
  /** Ganancia fija en vez de la calibrada. `null` = la del motor. */
  gainOverride: number | null;
  /** Congela el vídeo sin que el guardián de reproducción lo relance. */
  frozen: boolean;
  /** ÚNICA puerta para encender el hover bajo automatización (ver `lib/pointer.ts`). */
  habilitarHover?: () => void;
  hasPointer: boolean;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  dpr: number;
}

/** Lo que expone `AsciiPortrait` (Canvas 2D) en `window.__asciiPortrait`, solo con `?2d&debug`. */
export interface Motor2D {
  cols: number;
  rows: number;
  luma: Float32Array;
  rgb: Uint8ClampedArray;
  dpr: number;
  stepX: number;
  metrics: { cw: number; ch: number; fs: number; stretchX: number };
}

/** El `window` del navegador visto desde una sonda. */
export type VentanaSonda = Window &
  typeof globalThis & {
    __asciiGL?: MotorGL;
    __asciiPortrait?: Motor2D;
  };

/** Azúcar para leerlo dentro de `page.evaluate` sin repetir el casting en cada sonda. */
export function motorGL(w: Window): MotorGL {
  const g = (w as VentanaSonda).__asciiGL;
  if (!g) throw new Error('No hay __asciiGL en la página: ¿se cargó el motor WebGL?');
  return g;
}
