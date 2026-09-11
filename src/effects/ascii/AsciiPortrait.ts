// src/effects/ascii/AsciiPortrait.ts — retrato ASCII en Canvas 2D (§6.3). Fase 3.
// Sujeto: el jaguar de Javier. Base en --accent, highlights en --fg, shimmer, puntero,
// onda de entrada desde la cabeza, parallax y el modo color por clic (§6.3 punto 12).
//
// Tipografía (medida en scripts/diagnose-type.ts, comparada en screenshots/type/): el glifo se
// dimensiona por el alto real de su tinta, la celda se alinea al píxel de dispositivo y NO se
// estira en X. Las tres cosas juntas son lo que quita el aspecto "grueso y sucio".
//
// Presupuesto de 4 ms/frame (§8): repintar las ~6000 celdas cuesta ~11 ms, así que NUNCA se
// repinta todo en un frame de animación. Cada tipo de cambio toca solo lo suyo:
//   shimmer  → las ~180 celdas que cambiaron de glifo
//   onda     → solo el anillo que la cresta acaba de recorrer
//   puntero  → el rectángulo que cubre la posición anterior y la nueva
//   modo color → composición de dos canvas ya pintados (fallback previsto en §6.3 punto 11)

import { gsap, ScrollTrigger } from '../../core/gsap.ts';
import { clamp, isTouch, lerp, prefersReducedMotion, type Module } from '../../core/utils.ts';
import { charForLuma, denseChar } from './charRamp.ts';
import { colorDe, detectarRegiones, ACENTO_HOCICO, type PaletteMode } from './palette.ts';

export interface AsciiOptions {
  src: string;
  cellW?: number;
  cellH?: number;
  fontSize?: number;
  /** Radio del efecto del puntero, en celdas. */
  pointerRadius?: number;
  contrast?: number;
  /** Desenfoque previo al muestreo, en px del grid ×2 (§6.3 punto 3). */
  smooth?: number;
  /** Cuánto debe superar una celda a sus 8 vecinas para pintarse como highlight (§6.3 punto 6). */
  highlightDelta?: number;
  /** El retrato del footer no necesita reveal ni modo color. */
  interactive?: boolean;
  /**
   * Cómo se colorea el modo color tras el clic (§6.3 punto 12, Fase 8).
   * - `photo`: el RGB literal de la foto. Es lo que había, y sale pardo apagado — medido:
   *   el sujeto entero cabe en 11° de tono.
   * - `bands` / `ramp`: rampa diseñada sobre los cortes de Otsu. Ver `palette.ts`.
   * El modo ASCII base (acento + blancos) NO se toca en ninguno de los tres.
   */
  palette?: PaletteMode;
  /** Avisa del cambio de modo, venga del canvas o del botón accesible. */
  onModeChange?: (mode: 'ascii' | 'color') => void;
  /** Familia del retrato. JetBrains Mono es monoespaciada; Silkscreen NO (avances desiguales). */
  fontFamily?: string;
  /** Ajusta la celda a píxeles de dispositivo enteros: sin esto el texto sale borroso. */
  pixelSnap?: boolean;
  /**
   * Estira el glifo en X para llenar una celda cuadrada. Desactivado: deforma los trazos
   * verticales sin tocar los horizontales y es lo que más ensuciaba el retrato.
   */
  stretch?: boolean;
  /** Origen de la onda de entrada, en fracción del grid. Por defecto, la cabeza del jaguar. */
  revealOrigin?: { x: number; y: number };
  /** Duración del barrido, en segundos. Ajustable para poder compararlo sin recompilar. */
  revealDuration?: number;
  /** Curva del barrido. Ver la nota de REVEAL_EASE sobre por qué no usa "silk". */
  revealEase?: string;
}

const ALPHA_STEPS = 8;
const SHIMMER_MS = 120;
const SHIMMER_RATE = 0.03;
const FADE_DURATION = 0.9;
/** Sobremuestreo del canvas intermedio donde se aplica el desenfoque. */
const SMOOTH_SS = 2;
/** Grosor de la cresta de la onda de entrada, en celdas. */
const WAVE_BAND = 7;
/** Duración del barrido radial (§6.3 punto 9, ahora onda en vez de scanline). */
const REVEAL_DURATION = 3.2;
/**
 * "silk" (0.19,1,0.22,1) frena tantísimo que la cresta cruzaba el retrato en el primer cuarto
 * del tiempo y el resto era un goteo de celdas sueltas: alargar la duración con esa curva solo
 * alarga el goteo. Con power1.out la cresta avanza de forma legible durante todo el barrido.
 */
const REVEAL_EASE = 'power1.out';
/**
 * Sangría de color por hover (§6.3 punto 13). No es un círculo: el color se propaga celda a
 * celda desde donde toca el cursor y **se frena en los bordes del sujeto**, porque la
 * conductancia entre dos celdas vecinas cae con su diferencia de luminancia. Medido en la
 * referencia: allí el puntero NO revela color (la saturación BAJA de 0.667 a 0.600 al
 * acercarse, es un aclarado hacia blanco). Esto es un diferenciador pedido por Javier.
 */
const BLEED_CELLS = 26; // alcance máximo, en celdas: acota el coste por frame
/**
 * Dos frenos, no uno. El gradiente entre celdas VECINAS es demasiado ruidoso en un retrato de
 * pelaje para servir de señal de borde por sí solo: medido, las 6 direcciones desde un punto
 * cualquiera dan contrastes de 0.3 a 0.6, así que con un único factor agresivo la sangría
 * moría a 1–3 celdas del cursor en todas partes.
 *   BLEED_EDGE — frena en el salto local, para no atravesar una silueta.
 *   BLEED_TONE — mantiene el derrame dentro de tonos parecidos al de la celda semilla, que es
 *                lo que hace que llene el pelaje y se pare en el fondo o en un brillo.
 */
const BLEED_EDGE = 1.4;
const BLEED_TONE = 3.2;
const BLEED_RISE = 3.4; // velocidad de propagación, por segundo
const BLEED_FALL = 4.5; // velocidad de repliegue al salir el puntero
/** Cambio mínimo de sangría para molestarse en repintar una celda. */
const BLEED_EPS = 0.02;

/** Curva de alpha de las celdas base: alpha = ALPHA_FLOOR + ALPHA_RANGE · L. */
const ALPHA_FLOOR = 0.22;
const ALPHA_RANGE = 0.5;

interface Bucket {
  style: string;
  cells: Int32Array;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.trim().replace('#', '');
  const full = v.length === 3 ? v.replace(/./g, (c) => c + c) : v;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function readToken(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export class AsciiPortrait implements Module {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sampler: HTMLCanvasElement;
  private readonly samplerCtx: CanvasRenderingContext2D;
  private readonly blur: HTMLCanvasElement;
  private readonly blurCtx: CanvasRenderingContext2D;
  private readonly opts: Required<AsciiOptions>;
  private readonly reduced = prefersReducedMotion();

  private image: HTMLImageElement | null = null;
  private cols = 0;
  private rows = 0;
  private dpr = 1;

  // Datos por celda
  private luma = new Float32Array(0);
  private rgb = new Uint8ClampedArray(0);
  private highlight = new Uint8Array(0);
  private salt = new Uint16Array(0);
  private cellX = new Int16Array(0);
  private cellY = new Int16Array(0);
  /** Distancia de cada celda al origen de la onda, precalculada en el muestreo. */
  private cellDist = new Float32Array(0);
  /** Cuánto color se ha revelado en cada celda, 0..1. */
  private bleed = new Float32Array(0);
  private bleedNext = new Float32Array(0);
  /** Celdas cuya sangría cambió este frame y hay que repintar. */
  private bleedDirty: number[] = [];
  private bleedActive = false;
  /** Luminancia de la celda donde nació el derrame: define qué tonos son "parecidos". */
  private bleedSeed = 0;
  private chars: string[] = [];
  private buckets: Bucket[] = [];

  // Estado. La entrada es una onda radial desde la cabeza (§6.3 punto 9), no un barrido:
  // se dibuja lo que queda dentro de `revealRadius` y la cresta se aclara al pasar.
  private revealRadius = 0;
  private drawnRadius = 0;
  private colorMix = 0;
  /** 1 en las celdas del interior del hocico, para el acento rojo. */
  private hocico = new Uint8Array(0);
  private mode: 'ascii' | 'color' = 'ascii';
  private pointerX = -999;
  private pointerY = -999;
  private targetX = -999;
  private targetY = -999;
  private hasPointer = false;
  private lastShimmer = 0;
  private lastBleed = 0;
  /** Caja de las celdas con sangría viva, para no recorrer el alcance máximo cada paso. */
  private bx0 = 0;
  private bx1 = -1;
  private by0 = 0;
  private by1 = -1;
  private shimmerDirty: number[] = [];
  private running = false;
  private visible = true;
  private ready = false;
  private revealRequested = false;
  private frameCount = 0;
  private frameMs = 0;
  /** Peor frame desde la última publicación en el atributo. */
  private frameMsPeak = 0;
  /** Paso horizontal en el espacio ya estirado: una celda = un avance de glifo. */
  private stepX = 0;
  /** Celda y tamaño de fuente EFECTIVOS: ya ajustados a píxel y al alto real del glifo. */
  private cw = 0;
  private ch = 0;
  private fs = 0;
  private stretchX = 1;

  // Crossfade ascii ↔ color: dos canvas ya pintados que se componen por opacidad
  private fadeFrom: HTMLCanvasElement | null = null;
  private fadeTo: HTMLCanvasElement | null = null;
  private fading = false;

  /** Los 18 colores posibles cuando la celda no lleva mezcla: 2 paletas × 9 escalones de
      alpha. Construir la cadena `rgba(...)` celda a celda era el grueso del coste del
      repintado del puntero, que recorre miles de celdas por frame mientras el cursor se
      mueve. Si algún día la paleta deja de leerse una sola vez, hay que reconstruirla. */
  private styleCache: string[] = [];
  private accent: [number, number, number];
  private fg: [number, number, number];

  private observer: IntersectionObserver | null = null;
  private triggers: ScrollTrigger[] = [];
  private readonly onTick = (): void => this.frame();

  constructor(canvas: HTMLCanvasElement, options: AsciiOptions) {
    this.canvas = canvas;

    const { onModeChange, ...rest } = options;
    this.opts = {
      // Celda 4.00: se ABANDONA a propósito el 7.56 medido en la referencia
      // (scripts/measure-grid.ts) para ganar densidad — x3.6 celdas, 162x225. El 7.56 sigue
      // siendo el dato correcto sobre good-fella.com; esto es una divergencia deliberada, no
      // una corrección de aquella medida. Límites que sitúan el 4.00 como suelo práctico
      // (scripts/measure-density.ts + measure-paint-scaling.ts + measure-detail.ts):
      //   · legibilidad — el glifo baja a 8.0 px de dispositivo; a celda 3.0 son 4.5 px y deja
      //     de leerse como carácter;
      //   · `paintAll` — 21 ms aquí, pero hay un acantilado entre 3.5 y 3.0 (26 -> 82 ms);
      //   · la foto — 3.07 px de fuente por celda, aún por encima de los ~2.5 donde
      //     518x691 empieza a limitar (por eso una foto de más resolución no compra nada).
      cellW: 4,
      cellH: 4,
      // 0 = automático: se deduce del alto real de la tinta para que el glifo quepa en la celda
      fontSize: 0,
      pointerRadius: 6,
      contrast: 1.4,
      // Calibrados contra la proporción de highlights medida en la referencia (24 % de las
      // celdas con color). Ver scripts/measure-detail.ts y scripts/verify-combined.ts.
      //
      // `smooth` baja de 1.0 a 0.6: el suavizado a 1.0 destruía el 25 % del detalle local
      // (grad 0.1946 -> 0.1457) y el ruido de pelaje que lo justificaba NO aparece — a
      // smooth 0 los highlights son 91.5 % cadenas estructurales y solo 2.2 % celdas
      // aisladas. Lo que trae el moteado es SUBIR el umbral, no bajar el blur: un umbral
      // alto solo deja pasar picos de contraste extremo, que es exactamente el pelaje.
      //
      // `highlightDelta` NO es transferible entre tamaños de celda y por eso no es el 0.16
      // que calibró measure-detail.ts a celda 7.56: el highlight se decide contra las 8
      // vecinas, y al reducir la celda esas vecinas caen más juntas en la foto, así que el
      // contraste local baja y el mismo umbral da MENOS highlights (0.16 a celda 4.00 se
      // desploma a 12.2 %, la mitad del objetivo). Re-barrido a esta densidad, 0.11 da
      // 24.1 % frente al 24.0 % de la referencia.
      smooth: 0.6,
      highlightDelta: 0.11,
      interactive: true,
      // Por defecto la foto: nada cambia hasta que Javier apruebe la paleta (Fase 8, parte 1)
      palette: 'photo',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      pixelSnap: true,
      // Sin estirar (decisión de Javier tras comparar en screenshots/type/): el estirado ×1.67
      // engordaba los trazos verticales y era la causa principal del aspecto "grueso y sucio".
      // La contrapartida: el glifo ocupa ~60 % del ancho, así que la celda es cuadrada como
      // rejilla pero no como mancha de tinta.
      stretch: false,
      // La cabeza del jaguar: de ahí sale la onda, como una piedra al caer al agua
      revealOrigin: { x: 0.28, y: 0.36 },
      revealDuration: REVEAL_DURATION,
      revealEase: REVEAL_EASE,
      ...rest,
      onModeChange: onModeChange ?? ((): void => {}),
    };

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D no disponible');
    this.ctx = ctx;

    this.sampler = document.createElement('canvas');
    const sctx = this.sampler.getContext('2d', { willReadFrequently: true });
    if (!sctx) throw new Error('Canvas de muestreo no disponible');
    this.samplerCtx = sctx;

    this.blur = document.createElement('canvas');
    const bctx = this.blur.getContext('2d');
    if (!bctx) throw new Error('Canvas de suavizado no disponible');
    this.blurCtx = bctx;

    // El retrato pinta sobre casi-negro, así que NO usa el relleno de marca: usa la variante
    // clara del acento. Con la guinda a pelo (luminancia 0.096 contra 0.734 del verde anterior)
    // el dibujo se apaga — está medido en `measure-acento.ts`. El respaldo del token lleva el
    // MISMO valor que `tokens.css`: un respaldo desactualizado reintroduce el color viejo sin
    // que nadie se entere, que es justo lo que la auditoría encontró con el verde.
    this.accent = hexToRgb(readToken('--accent', '#39ff6a'));
    this.fg = hexToRgb(readToken('--fg', '#eeeeee'));
    this.buildStyleCache();

    void this.load();
  }

  get lastFrameMs(): number {
    return this.frameMs;
  }

  get currentMode(): 'ascii' | 'color' {
    return this.mode;
  }

  /** Métricas efectivas tras el ajuste a píxel y al alto del glifo (las lee ?debug). */
  get metrics(): { cw: number; ch: number; fs: number; stretchX: number } {
    return { cw: this.cw, ch: this.ch, fs: this.fs, stretchX: this.stretchX };
  }

  private async load(): Promise<void> {
    const image = new Image();
    image.decoding = 'async';
    image.src = this.opts.src;

    try {
      await image.decode();
    } catch {
      return; // el asset aún no existe: canvas vacío, sin romper nada (§7)
    }

    this.image = image;
    this.resize();
    this.attach();

    if (this.reduced || !this.opts.interactive) {
      this.revealRadius = this.maxRadius() + WAVE_BAND;
      this.drawnRadius = this.revealRadius;
      this.paintWithin(this.revealRadius);
    } else {
      this.ready = true;
      if (this.revealRequested) this.reveal();
    }
  }

  /**
   * Barrido de scanline (§6.3 punto 8). Arranca al TERMINAR el preloader, no al decodificar la
   * imagen: si no, el reveal ocurriría tapado por el overlay y nadie lo vería.
   */
  reveal(): void {
    if (this.reduced || !this.opts.interactive) return;

    if (!this.ready) {
      this.revealRequested = true;
      return;
    }

    this.revealRadius = 0;
    this.drawnRadius = 0;
    this.canvas.dataset.reveal = '0';
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    gsap.fromTo(
      this,
      { revealRadius: 0 },
      {
        revealRadius: this.maxRadius() + WAVE_BAND,
        duration: this.opts.revealDuration,
        ease: this.opts.revealEase,
        overwrite: true,
      },
    );
  }

  /** Origen de la onda en celdas. */
  private origin(): { x: number; y: number } {
    return {
      x: this.opts.revealOrigin.x * this.cols,
      y: this.opts.revealOrigin.y * this.rows,
    };
  }

  /** Distancia desde el origen hasta la esquina más lejana: cuándo termina la onda. */
  private maxRadius(): number {
    const o = this.origin();
    return Math.max(
      Math.hypot(o.x, o.y),
      Math.hypot(this.cols - o.x, o.y),
      Math.hypot(o.x, this.rows - o.y),
      Math.hypot(this.cols - o.x, this.rows - o.y),
    );
  }

  // ---------------------------------------------------------------- muestreo

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || !this.image) return;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);

    this.computeMetrics();

    this.cols = Math.max(1, Math.floor(rect.width / this.cw));
    this.rows = Math.max(1, Math.floor(rect.height / this.ch));

    this.sample();
  }

  /**
   * Calcula la celda y el tamaño de fuente EFECTIVOS. Dos correcciones medidas
   * (scripts/diagnose-type.ts) que explican el aspecto "grueso y sucio":
   *
   *  1. A 7.56 px, JetBrains Mono tiene una caja de fuente de 10 px y una caja de tinta de 8 px:
   *     el glifo se salía 2.44 px e invadía la fila siguiente. Aquí se reduce `fontSize` hasta
   *     que la tinta real de la rampa cabe dentro de la celda.
   *  2. Con celda 7.56 a DPR 1, las columnas caían en 7.56 / 15.12 / 22.68… — píxeles
   *     fraccionarios, que el rasterizador difumina. `pixelSnap` lleva la celda al entero de
   *     dispositivo más cercano para que cada glifo caiga sobre la rejilla física.
   */
  private computeMetrics(): void {
    const snap = (v: number): number =>
      this.opts.pixelSnap ? Math.max(1, Math.round(v * this.dpr)) / this.dpr : v;

    this.cw = snap(this.opts.cellW);
    this.ch = snap(this.opts.cellH);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Se mide la tinta real de toda la rampa a un tamaño de sonda y se escala para que quepa
    const probe = this.ch;
    ctx.font = `${probe}px ${this.opts.fontFamily}`;
    let ink = 0;
    for (const ch of `.'\`:,;-~+17cr23ae56bd89AE04BCDF68#%@`) {
      const m = ctx.measureText(ch);
      ink = Math.max(ink, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
    }

    const fitted = ink > 0 ? probe * (this.ch / ink) : this.ch;
    this.fs = this.opts.fontSize > 0 ? this.opts.fontSize : fitted;

    ctx.font = `${this.fs}px ${this.opts.fontFamily}`;
    const advance = ctx.measureText('0').width || this.fs * 0.6;

    this.stretchX = this.opts.stretch ? this.cw / advance : 1;
    this.stepX = this.cw / this.stretchX;
  }

  private sample(): void {
    if (!this.image) return;

    const { cols, rows } = this;
    const total = cols * rows;

    // §6.3 punto 2 — recorte "cover" contra la proporción del ÁREA MOSTRADA, no contra cols/rows:
    // con celdas no cuadradas lo segundo deforma al sujeto en exactamente cellH/cellW.
    const targetAspect = (cols * this.cw) / (rows * this.ch);
    const srcAspect = this.image.width / this.image.height;

    let sw = this.image.width;
    let sh = this.image.height;
    if (srcAspect > targetAspect)
      sw = sh * targetAspect; // fuente más ancha: se recortan los lados
    else sh = sw / targetAspect; // más alta: se recorta arriba/abajo
    const sx0 = (this.image.width - sw) / 2;
    const sy0 = (this.image.height - sh) / 2;

    // §6.3 punto 3 — desenfoque previo a la escala del grid: promedia los patrones repetitivos
    // (el pelaje moteado) entre celdas vecinas para que no disparen el detector de highlight,
    // mientras que los bordes estructurales (mandíbula, hocico, colmillos) sobreviven.
    this.blur.width = cols * SMOOTH_SS;
    this.blur.height = rows * SMOOTH_SS;
    this.blurCtx.clearRect(0, 0, this.blur.width, this.blur.height);
    this.blurCtx.filter = this.opts.smooth > 0 ? `blur(${this.opts.smooth}px)` : 'none';
    this.blurCtx.drawImage(this.image, sx0, sy0, sw, sh, 0, 0, this.blur.width, this.blur.height);
    this.blurCtx.filter = 'none';

    this.sampler.width = cols;
    this.sampler.height = rows;
    this.samplerCtx.clearRect(0, 0, cols, rows);
    this.samplerCtx.drawImage(this.blur, 0, 0, this.blur.width, this.blur.height, 0, 0, cols, rows);

    const data = this.samplerCtx.getImageData(0, 0, cols, rows).data;

    this.luma = new Float32Array(total);
    this.rgb = new Uint8ClampedArray(total * 3);
    this.highlight = new Uint8Array(total);
    this.salt = new Uint16Array(total);
    this.cellX = new Int16Array(total);
    this.cellY = new Int16Array(total);
    this.cellDist = new Float32Array(total);
    this.bleed = new Float32Array(total);
    this.bleedNext = new Float32Array(total);
    this.chars = new Array<string>(total);

    for (let i = 0; i < total; i++) {
      const r = data[i * 4] ?? 0;
      const g = data[i * 4 + 1] ?? 0;
      const b = data[i * 4 + 2] ?? 0;

      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const adjusted = clamp((l - 0.15) * this.opts.contrast, 0, 1);
      this.luma[i] = adjusted;

      // El modo color usa el tono real de la foto con la MISMA curva de contraste que el ASCII:
      // sin esto los ámbar del jaguar salen apagados sobre el fondo negro.
      const k = clamp(adjusted / Math.max(l, 0.02), 0, 2.6);
      this.rgb[i * 3] = r * k;
      this.rgb[i * 3 + 1] = g * k;
      this.rgb[i * 3 + 2] = b * k;

      this.cellY[i] = (i / cols) | 0;
      this.cellX[i] = i % cols;
    }

    // Distancias al origen de la onda: se calculan una vez y se leen en cada frame
    const ox = this.opts.revealOrigin.x * cols;
    const oy = this.opts.revealOrigin.y * rows;
    for (let i = 0; i < total; i++) {
      this.cellDist[i] = Math.hypot((this.cellX[i] ?? 0) - ox, (this.cellY[i] ?? 0) - oy);
    }

    // Highlight = contraste local alto respecto a las 8 vecinas (§6.3 punto 5)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            sum += this.luma[ny * cols + nx] ?? 0;
            n++;
          }
        }
        this.highlight[i] = (this.luma[i] ?? 0) - (n > 0 ? sum / n : 0) > this.opts.highlightDelta ? 1 : 0;
      }
    }

    // Región del hocico para el acento de color. Se calcula UNA vez, aquí: depende solo de
    // la foto muestreada, no del frame.
    const regiones = detectarRegiones(this.rgb, this.luma, cols, rows, 0.12);
    this.hocico = regiones.hocico;
    this.canvas.dataset.regiones = JSON.stringify(
      regiones.comps.slice(0, 6).map((c) => ({ n: c.n, x: +c.cx.toFixed(2), y: +c.cy.toFixed(2) })),
    );

    for (let i = 0; i < total; i++) this.updateChar(i);
    this.buckets = this.makeBuckets(this.colorMix);
  }

  private updateChar(i: number): void {
    this.chars[i] = charForLuma(this.luma[i] ?? 0, i, this.salt[i] ?? 0);
  }

  /** Agrupa celdas por estilo para no cambiar `fillStyle` por celda (§6.3 punto 5). */
  private makeBuckets(mix: number): Bucket[] {
    const total = this.cols * this.rows;
    const map = new Map<string, number[]>();

    for (let i = 0; i < total; i++) {
      const l = this.luma[i] ?? 0;
      if (l < 0.12) continue;

      const style = this.styleFor(i, l, Math.max(mix, this.bleed[i] ?? 0));
      let list = map.get(style);
      if (!list) {
        list = [];
        map.set(style, list);
      }
      list.push(i);
    }

    return [...map].map(([style, cells]) => ({ style, cells: Int32Array.from(cells) }));
  }

  /** Precalcula los colores sin mezcla. Depende solo de `accent`, `fg` y ALPHA_STEPS. */
  private buildStyleCache(): void {
    const tabla: string[] = [];
    for (let hi = 0; hi < 2; hi++) {
      const base = hi === 1 ? this.fg : this.accent;
      for (let a = 0; a <= ALPHA_STEPS; a++) {
        tabla[hi * (ALPHA_STEPS + 1) + a] = this.rgba(base[0], base[1], base[2], a / ALPHA_STEPS);
      }
    }
    this.styleCache = tabla;
  }

  private styleFor(i: number, l: number, mix: number): string {
    const isHi = this.highlight[i] === 1;
    const base = isHi ? this.fg : this.accent;
    // Curva de alpha de la base: el suelo bajó de 0.35 a 0.22 para acercarse a la delicadeza
    // de la referencia (decisión de Javier). Los highlights NO se tocan: siguen a tope para
    // que los bordes sigan destacando sobre una base ahora más tenue.
    const alpha = isHi ? 0.9 + 0.1 * l : ALPHA_FLOOR + ALPHA_RANGE * l;

    if (mix <= 0) {
      const paso = Math.round(clamp(alpha, 0, 1) * ALPHA_STEPS);
      return (
        this.styleCache[(isHi ? ALPHA_STEPS + 1 : 0) + paso] ?? this.rgba(base[0], base[1], base[2], alpha)
      );
    }

    // El DESTINO de la mezcla es lo único que cambia entre paletas: la maquinaria del
    // crossfade y de la sangría no se entera, así que la transición sigue igual.
    const [r, g, b] = this.destinoColor(i, l);

    return this.rgba(
      lerp(base[0], r, mix),
      lerp(base[1], g, mix),
      lerp(base[2], b, mix),
      lerp(alpha, 0.55 + 0.45 * l, mix),
    );
  }

  /** Hacia qué color tira el modo color en esta celda, según la paleta elegida. */
  private destinoColor(i: number, l: number): readonly [number, number, number] {
    const modo = this.opts.palette;
    if (modo === 'photo') {
      return [this.rgb[i * 3] ?? 0, this.rgb[i * 3 + 1] ?? 0, this.rgb[i * 3 + 2] ?? 0];
    }
    // Acento de región: el hocico manda sobre la rampa. Es el ÚNICO que los datos sostienen
    // — ver `detectarRegiones`, donde está medido por qué la coronilla no da un componente.
    if (this.hocico[i] === 1) return ACENTO_HOCICO;
    return colorDe(modo, l);
  }

  private rgba(r: number, g: number, b: number, a: number): string {
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${
      Math.round(clamp(a, 0, 1) * ALPHA_STEPS) / ALPHA_STEPS
    })`;
  }

  // ---------------------------------------------------------------- pintado

  /**
   * Prepara el contexto y calcula el estirado horizontal del texto (§6.3 punto 1).
   * La referencia dibuja cada glifo como un quad cuadrado de un atlas WebGL; `fillText` avanza
   * ~0.6 em, así que en una celda cuadrada dejaría hueco. Se estira en X con UNA transformación
   * por pasada (nunca por glifo) y las coordenadas x pasan a medirse en avances de glifo.
   */
  private prepare(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr * this.stretchX, 0, 0, this.dpr, 0, 0);
    ctx.font = `${this.fs}px ${this.opts.fontFamily}`;
    ctx.textBaseline = 'top';
  }

  /** Pinta todas las celdas dentro de `radius`, agrupando por estilo. */
  private paintWithin(radius: number, ctx = this.ctx): void {
    this.prepare(ctx);

    const cellH = this.ch;
    const stepX = this.stepX;

    for (const bucket of this.buckets) {
      ctx.fillStyle = bucket.style;
      const cells = bucket.cells;

      for (let k = 0; k < cells.length; k++) {
        const i = cells[k] ?? 0;
        if ((this.cellDist[i] ?? 0) > radius) continue;
        ctx.fillText(this.chars[i] ?? '', (this.cellX[i] ?? 0) * stepX, (this.cellY[i] ?? 0) * cellH);
      }
    }
  }

  /**
   * Repinta el anillo que la onda acaba de atravesar (§6.3 punto 9). Las celdas de la cresta
   * se aclaran hacia --fg y vuelven a su color al quedar detrás, que es lo que da la sensación
   * de piedra cayendo al agua.
   */
  private paintWave(from: number, to: number): void {
    const ctx = this.ctx;
    this.prepare(ctx);

    const cellH = this.ch;
    const stepX = this.stepX;
    const total = this.cols * this.rows;

    for (let i = 0; i < total; i++) {
      const d = this.cellDist[i] ?? 0;
      if (d < from || d > to) continue;

      const px = (this.cellX[i] ?? 0) * stepX;
      const py = (this.cellY[i] ?? 0) * cellH;
      ctx.clearRect(px, py, stepX, cellH);

      // Todavía por delante de la onda: la celda queda vacía
      if (d > this.revealRadius) continue;

      const l = this.luma[i] ?? 0;
      if (l < 0.12) continue;

      // Cresta: cuanto más cerca del frente, más se aclara hacia blanco
      const crest = 1 - (this.revealRadius - d) / WAVE_BAND;

      if (crest > 0) {
        const lifted = clamp(l + 0.4 * crest, 0, 1);
        ctx.fillStyle = this.rgba(this.fg[0], this.fg[1], this.fg[2], 0.35 + 0.65 * crest);
        ctx.fillText(denseChar(lifted, i, this.salt[i] ?? 0), px, py);
      } else {
        ctx.fillStyle = this.styleFor(i, l, this.mixFor(i));
        ctx.fillText(this.chars[i] ?? '', px, py);
      }
    }
  }

  /** Repinta solo las celdas indicadas (las que tocó el shimmer). */
  private paintCells(indices: number[]): void {
    if (indices.length === 0) return;
    const ctx = this.ctx;
    this.prepare(ctx);

    const cellH = this.ch;
    const stepX = this.stepX;
    const reveal = this.revealRadius;

    for (const i of indices) {
      const y = this.cellY[i] ?? 0;
      if ((this.cellDist[i] ?? 0) > reveal) continue;

      const x = this.cellX[i] ?? 0;
      const px = x * stepX;
      const py = y * cellH;

      ctx.clearRect(px, py, stepX, cellH);

      const l = this.luma[i] ?? 0;
      if (l < 0.12) continue;

      ctx.fillStyle = this.styleFor(i, l, this.mixFor(i));
      ctx.fillText(this.chars[i] ?? '', px, py);
    }
  }

  /**
   * Un paso de la sangría de color. La propagación es una difusión sobre la rejilla de celdas
   * cuya CONDUCTANCIA entre vecinas cae exponencialmente con su diferencia de luminancia:
   * donde hay un borde del sujeto, |ΔL| es grande, la conductancia tiende a 0 y el color se
   * queda de ese lado. Eso es lo que hace que se derrame siguiendo la forma del jaguar en vez
   * de dibujar un disco.
   *
   * Se recorre solo la caja alrededor del puntero (BLEED_CELLS de radio), así el coste está
   * acotado y no depende del tamaño del retrato. Devuelve true si algo cambió.
   */
  private stepBleed(dt: number): boolean {
    const cols = this.cols;
    const rows = this.rows;
    const on = this.hasPointer && this.pointerX > -100;

    // Sin puntero y sin nada revelado no hay trabajo que hacer.
    if (!on && !this.bleedActive) return false;

    const cx = Math.round(this.pointerX);
    const cy = Math.round(this.pointerY);
    const R = BLEED_CELLS;

    // La caja a recorrer NO es el alcance máximo: es lo ya teñido más un margen de una celda,
    // que es hasta donde puede avanzar el frente en un paso. Recorrer siempre 53×53 celdas
    // costaba lo mismo con el derrame recién nacido que con él extendido del todo, y eso es
    // lo que sacaba el pintado del presupuesto de 4 ms de §8 en barridos bruscos.
    const margen = 2;
    let minX = on ? Math.max(0, cx - margen) : cols;
    let maxX = on ? Math.min(cols - 1, cx + margen) : -1;
    let minY = on ? Math.max(0, cy - margen) : rows;
    let maxY = on ? Math.min(rows - 1, cy + margen) : -1;
    if (this.bleedActive) {
      minX = Math.min(minX, Math.max(0, this.bx0 - margen));
      maxX = Math.max(maxX, Math.min(cols - 1, this.bx1 + margen));
      minY = Math.min(minY, Math.max(0, this.by0 - margen));
      maxY = Math.max(maxY, Math.min(rows - 1, this.by1 + margen));
    }
    if (maxX < minX || maxY < minY) return false;
    // Y nunca más allá del alcance máximo alrededor del puntero.
    if (on) {
      minX = Math.max(minX, Math.max(0, cx - R));
      maxX = Math.min(maxX, Math.min(cols - 1, cx + R));
      minY = Math.max(minY, Math.max(0, cy - R));
      maxY = Math.min(maxY, Math.min(rows - 1, cy + R));
    }

    // Tono de la celda semilla: se refresca mientras el puntero está encima.
    if (on) {
      const si = Math.min(rows - 1, Math.max(0, cy)) * cols + Math.min(cols - 1, Math.max(0, cx));
      this.bleedSeed = this.luma[si] ?? 0;
    }

    const rise = 1 - Math.exp(-BLEED_RISE * dt);
    const fall = 1 - Math.exp(-BLEED_FALL * dt);
    this.bleedDirty.length = 0;
    let vivo = false;
    // Caja de lo que queda teñido, para acotar el recorrido del paso siguiente.
    let nx0 = cols;
    let nx1 = -1;
    let ny0 = rows;
    let ny1 = -1;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * cols + x;
        const cur = this.bleed[i] ?? 0;

        let objetivo = 0;
        if (on) {
          const d = Math.hypot(x - cx, y - cy);
          if (d <= 1.5) {
            objetivo = 1; // la celda bajo el cursor es la fuente, y marca el tono de referencia
          } else if (d <= R) {
            // Lo que llega de las vecinas, atenuado por el borde que haya entre medias.
            const l = this.luma[i] ?? 0;
            // Parecido al tono de donde nació el derrame: es lo que lo mantiene dentro del
            // pelaje y lo para en el fondo o en un brillo. NO se compone paso a paso.
            const tono = Math.exp(-BLEED_TONE * Math.abs(l - this.bleedSeed));

            // Conectividad BINARIA: basta con tocar una celda ya teñida. Multiplicar por el
            // valor del vecino hacía que la cadena decayera geométricamente y el derrame
            // moría a 3-4 celdas del cursor por mucho que se bajara la constante — medido.
            let conectado = 0;
            let saltoLocal = 1;
            for (const [ox, oy] of [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ] as const) {
              const nx = x + ox;
              const ny = y + oy;
              if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
              const j = ny * cols + nx;
              if ((this.bleed[j] ?? 0) > 0.06) {
                conectado = 1;
                saltoLocal = Math.min(saltoLocal, Math.abs(l - (this.luma[j] ?? 0)));
              }
            }
            if (conectado === 0) continue;

            // Freno suave en el salto local, para no atravesar una silueta de golpe.
            const borde = Math.exp(-BLEED_EDGE * saltoLocal);
            objetivo = tono * borde * (1 - d / R);
          }
        }

        let next = cur + (objetivo - cur) * (objetivo > cur ? rise : fall);
        // El repliegue es exponencial y nunca llega a 0 por sí solo: se corta el rabo, o
        // `bleedActive` se quedaba en true para siempre tras salir el puntero.
        if (next < 0.02 && objetivo === 0) next = 0;
        this.bleedNext[i] = next;
        if (next > 0) {
          vivo = true;
          if (x < nx0) nx0 = x;
          if (x > nx1) nx1 = x;
          if (y < ny0) ny0 = y;
          if (y > ny1) ny1 = y;
        }
        if (Math.abs(next - cur) > BLEED_EPS) this.bleedDirty.push(i);
      }
    }

    // Volcado del buffer: solo la caja recorrida.
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * cols + x;
        this.bleed[i] = this.bleedNext[i] ?? 0;
      }
    }

    this.bleedActive = vivo;
    this.bx0 = nx0;
    this.bx1 = nx1;
    this.by0 = ny0;
    this.by1 = ny1;
    return this.bleedDirty.length > 0;
  }

  /** Mezcla de color efectiva de una celda: el modo clic y la sangría del hover, lo que mande. */
  private mixFor(i: number): number {
    const b = this.bleed[i] ?? 0;
    return b > this.colorMix ? b : this.colorMix;
  }

  /** Repinta el rectángulo que cubre la posición anterior y la actual del puntero. */
  private paintPointerRegion(prevX: number, prevY: number): void {
    const ctx = this.ctx;
    const cellH = this.ch;
    const pad = this.opts.pointerRadius + 1;
    const cols = this.cols;
    const reveal = this.revealRadius;

    // Dos cajas, una por posición, en vez de la caja que las UNE: en un barrido rápido la
    // unión arrastra toda la franja intermedia, que no toca ninguno de los dos discos y se
    // repintaba entera cada frame. Si se solapan no hay nada que ganar y se usa la unión,
    // que además evita pintar dos veces la intersección.
    const caja = (cx: number, cy: number): [number, number, number, number] => [
      Math.max(0, Math.floor(cx - pad)),
      Math.min(cols - 1, Math.ceil(cx + pad)),
      Math.max(0, Math.floor(cy - pad)),
      Math.min(this.rows - 1, Math.ceil(cy + pad)),
    ];
    const a = caja(prevX, prevY);
    const b = caja(this.pointerX, this.pointerY);
    const solapan = a[0] <= b[1] && b[0] <= a[1] && a[2] <= b[3] && b[2] <= a[3];
    const cajas: Array<[number, number, number, number]> = solapan
      ? [[Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])]]
      : [a, b];

    this.prepare(ctx);
    const stepX = this.stepX;

    const px = this.pointerX;
    const py = this.pointerY;
    const radius = this.opts.pointerRadius;
    const pointerOn = this.hasPointer && px > -100;
    // El canvas reparsea la cadena en CADA asignación de `fillStyle`, así que con la tabla
    // de arriba la mayoría de celdas contiguas comparten color y se puede saltar la asignación.
    let ultimo = '';

    for (const [minX, maxX, minY, maxY] of cajas) {
      if (maxX < minX || maxY < minY) continue;
      ctx.clearRect(minX * stepX, minY * cellH, (maxX - minX + 1) * stepX, (maxY - minY + 1) * cellH);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const i = y * cols + x;
          // Lo que la onda todavía no ha alcanzado no se dibuja
          if ((this.cellDist[i] ?? 0) > reveal) continue;

          const l = this.luma[i] ?? 0;
          if (l < 0.12) continue;

          // Distancia AL CUADRADO: `Math.hypot` es lento (protege del desbordamiento, que aquí
          // no puede pasar) y la inmensa mayoría de celdas solo necesita saber si cae fuera del
          // radio. La raíz se saca únicamente dentro, que son unas pocas decenas de celdas.
          const dx0 = x - px;
          const dy0 = y - py;
          const d2 = pointerOn ? dx0 * dx0 + dy0 * dy0 : Infinity;

          if (d2 <= radius * radius) {
            const dist = Math.sqrt(d2);
            // Se eleva la luminancia y se densifica el glifo, pero el COLOR ya no es blanco
            // plano: sale de `styleFor` con la mezcla de la sangría. Pintar aquí `--fg` a pelo
            // tapaba justo el centro del derrame — medido: la saturación BAJABA un 23.5 %
            // donde más debía subir. El círculo uniforme es lo que la sangría viene a sustituir.
            const falloff = 1 - dist / radius;
            const lifted = clamp(l + 0.18 * falloff, 0, 1);
            const estilo = this.styleFor(i, lifted, this.mixFor(i));
            if (estilo !== ultimo) {
              ctx.fillStyle = estilo;
              ultimo = estilo;
            }
            // El ripple va en el espacio ya estirado, por eso se divide por el factor
            const dx = (Math.sin((y + this.lastShimmer * 0.002) * 1.7) * 2 * falloff * stepX) / this.cw;
            ctx.fillText(denseChar(lifted, i, this.salt[i] ?? 0), x * stepX + dx, y * cellH);
          } else {
            const estilo = this.styleFor(i, l, this.mixFor(i));
            if (estilo !== ultimo) {
              ctx.fillStyle = estilo;
              ultimo = estilo;
            }
            ctx.fillText(this.chars[i] ?? '', x * stepX, y * cellH);
          }
        }
      }
    }
  }

  /** Repinta el retrato completo. Solo en momentos puntuales, nunca por frame. */
  private paintAll(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.paintWithin(this.revealRadius);
    this.drawnRadius = this.revealRadius;
  }

  // ---------------------------------------------------------------- ciclo

  private attach(): void {
    // Con puntero grueso no hay cursor que seguir: ni el empuje de luminancia ni la sangría
    // de color tienen premisa, y son justo el trabajo por frame que un móvil menos necesita.
    // El clic para alternar a color sí se conserva: esa es la afordancia táctil del retrato.
    if (!isTouch()) {
      this.canvas.addEventListener('pointermove', this.onPointerMove);
      this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    }

    if (this.opts.interactive) {
      this.canvas.addEventListener('click', this.onClick);
      this.canvas.style.cursor = 'pointer';
    }

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    // Pausa fuera del viewport (§6.3 punto 10)
    this.observer = new IntersectionObserver(
      ([entry]) => {
        this.visible = entry?.isIntersecting ?? false;
        this.toggleLoop();
      },
      { rootMargin: '100px' },
    );
    this.observer.observe(this.canvas);

    // Parallax del canvas dentro del hero (§6.3 punto 9)
    if (!this.reduced && this.opts.interactive) {
      const host = this.canvas.closest<HTMLElement>('[data-hero-visual]') ?? this.canvas;
      this.triggers.push(
        ScrollTrigger.create({
          trigger: host,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
          animation: gsap.to(this.canvas, { yPercent: 15, ease: 'none' }),
        }),
      );
    }

    this.toggleLoop();
  }

  private toggleLoop(): void {
    const should = this.visible && !document.hidden && this.image !== null;
    if (should === this.running) return;

    this.running = should;
    if (should) gsap.ticker.add(this.onTick);
    else gsap.ticker.remove(this.onTick);
  }

  private readonly onVisibility = (): void => this.toggleLoop();

  private readonly onResize = (): void => {
    this.resize();
    this.revealRadius = this.maxRadius() + WAVE_BAND;
    this.paintAll();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.targetX = ((event.clientX - rect.left) / rect.width) * this.cols;
    this.targetY = ((event.clientY - rect.top) / rect.height) * this.rows;
    this.hasPointer = true;
  };

  private readonly onPointerLeave = (): void => {
    this.hasPointer = false;
  };

  private readonly onClick = (): void => this.toggleMode();

  /**
   * §6.3 punto 11: alterna ascii ↔ color real.
   * Se usa el fallback que el propio spec autoriza: en vez de recalcular el color de las ~6000
   * celdas en cada frame (~11 ms, muy por encima del presupuesto), se pintan dos canvas una sola
   * vez y se componen por opacidad. Contrapartida documentada: el shimmer queda congelado
   * durante los 0.9 s de la transición.
   */
  /**
   * Cambia la paleta del modo color en caliente y repinta. Para comparar variantes sin
   * recompilar, igual que los sliders de `?debug` (Fase 8, parte 1).
   */
  setPalette(modo: PaletteMode): void {
    this.opts.palette = modo;
    this.buckets = this.makeBuckets(this.colorMix);
    this.paintAll();
  }

  toggleMode(): void {
    if (this.fading || !this.image) return;

    const next = this.mode === 'ascii' ? 'color' : 'ascii';
    const target = next === 'color' ? 1 : 0;
    this.mode = next;
    this.canvas.dataset.mode = next;
    this.opts.onModeChange(next);

    if (this.reduced) {
      this.colorMix = target;
      this.buckets = this.makeBuckets(target);
      this.paintAll();
      return;
    }

    const from = this.snapshot(this.colorMix);
    const to = this.snapshot(target);
    this.fadeFrom = from;
    this.fadeTo = to;
    this.fading = true;

    const state = { t: 0 };
    gsap.to(state, {
      t: 1,
      duration: FADE_DURATION,
      ease: 'main',
      overwrite: true,
      onUpdate: () => this.paintFade(state.t),
      onComplete: () => {
        this.fading = false;
        this.fadeFrom = null;
        this.fadeTo = null;
        this.colorMix = target;
        this.buckets = this.makeBuckets(target);
        this.paintAll();
      },
    });
  }

  /** Pinta el retrato completo en un canvas aparte, con la mezcla de color indicada. */
  private snapshot(mix: number): HTMLCanvasElement {
    const off = document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;

    const ctx = off.getContext('2d');
    if (!ctx) return off;

    const saved = this.buckets;
    this.buckets = this.makeBuckets(mix);
    this.paintWithin(this.revealRadius, ctx);
    this.buckets = saved;

    return off;
  }

  private paintFade(t: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.fadeFrom) {
      ctx.globalAlpha = 1 - t;
      ctx.drawImage(this.fadeFrom, 0, 0);
    }
    if (this.fadeTo) {
      ctx.globalAlpha = t;
      ctx.drawImage(this.fadeTo, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  private frame(): void {
    const started = performance.now();

    // Durante el crossfade solo se componen dos imágenes: nada que recalcular
    if (this.fading) {
      this.frameMs = performance.now() - started;
      return;
    }

    const prevX = this.pointerX;
    const prevY = this.pointerY;

    if (this.hasPointer) {
      this.pointerX = lerp(this.pointerX < -100 ? this.targetX : this.pointerX, this.targetX, 0.12);
      this.pointerY = lerp(this.pointerY < -100 ? this.targetY : this.pointerY, this.targetY, 0.12);
    } else {
      this.pointerX = -999;
      this.pointerY = -999;
    }

    let painted = false;

    // 1) Onda de entrada: solo se repinta el anillo que la cresta acaba de recorrer
    if (this.revealRadius > this.drawnRadius) {
      this.paintWave(this.drawnRadius - WAVE_BAND, this.revealRadius);
      this.drawnRadius = this.revealRadius;
      painted = true;
      // Progreso observable: lo leen ?debug y las suites, sin releer el canvas
      const full = this.maxRadius() + WAVE_BAND;
      this.canvas.dataset.reveal = Math.min(1, this.revealRadius / full).toFixed(3);
    }

    // 2) Shimmer: solo las celdas cuyo glifo cambió
    if (!this.reduced && this.shimmer()) {
      this.paintCells(this.shimmerDirty);
      painted = true;
    }

    // 3) Puntero: solo el rectángulo afectado
    const pointerMoved = Math.abs(prevX - this.pointerX) > 0.02 || Math.abs(prevY - this.pointerY) > 0.02;
    if (pointerMoved) {
      this.paintPointerRegion(prevX, prevY);
      painted = true;
    }

    // 4) Sangría de color: solo las celdas cuya mezcla cambió lo suficiente. La difusión
    //    recorre una caja acotada; el repintado, únicamente su frente de avance.
    if (!this.reduced && this.opts.interactive) {
      const dt = Math.min(0.05, (started - this.lastBleed) / 1000 || 0.016);
      this.lastBleed = started;
      if (this.stepBleed(dt)) {
        this.paintCells(this.bleedDirty);
        painted = true;
      }
    }

    this.frameMs = painted ? performance.now() - started : 0;

    // El atributo se escribe 1 de cada 10 frames para no pagar una escritura de DOM por
    // frame, así que publica el PEOR de su ventana y no el de un frame al azar: una lectura
    // suelta seguía siendo un dato real. Quien necesite la distribución completa lee
    // `lastFrameMs` de la instancia con `?debug`, que sí es por frame.
    if (this.frameMs > this.frameMsPeak) this.frameMsPeak = this.frameMs;
    if (++this.frameCount % 10 === 0) {
      this.canvas.dataset.frameMs = this.frameMsPeak.toFixed(2);
      this.frameMsPeak = 0;
    }
  }

  /** Cambia el glifo (no la luminancia) de un 3 % de celdas cada 120 ms (§6.3 punto 6). */
  private shimmer(): boolean {
    const now = performance.now();
    if (now - this.lastShimmer < SHIMMER_MS) return false;
    this.lastShimmer = now;

    const total = this.cols * this.rows;
    const picks = Math.floor(total * SHIMMER_RATE);
    this.shimmerDirty.length = 0;

    for (let n = 0; n < picks; n++) {
      const i = Math.floor(Math.random() * total);
      if ((this.luma[i] ?? 0) <= 0.35) continue;
      // Las celdas en highlight titilan el doble (§6.3 punto 6)
      if (this.highlight[i] === 0 && Math.random() < 0.5) continue;

      this.salt[i] = ((this.salt[i] ?? 0) + 1) % 4096;
      this.updateChar(i);
      this.shimmerDirty.push(i);
    }

    return this.shimmerDirty.length > 0;
  }

  /** Cambia parámetros en caliente (lo usa el panel de `?debug`). */
  update(partial: Partial<AsciiOptions>): void {
    Object.assign(this.opts, partial);
    this.resize();
    this.revealRadius = this.maxRadius() + WAVE_BAND;
    this.paintAll();
  }

  destroy(): void {
    gsap.ticker.remove(this.onTick);
    gsap.killTweensOf(this);
    gsap.killTweensOf(this.canvas);
    this.running = false;

    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('click', this.onClick);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);

    this.observer?.disconnect();
    this.observer = null;
    for (const t of this.triggers) t.kill();
    this.triggers = [];
    this.fadeFrom = null;
    this.fadeTo = null;
  }
}
