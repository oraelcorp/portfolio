// src/effects/ascii/AsciiPortrait.ts — retrato ASCII en Canvas 2D (§6.3). Fase 3.
// Sujeto: el jaguar de Javier. Base en --accent, highlights en --fg, shimmer, puntero,
// reveal por scanline, parallax y el modo color por clic (§6.3 punto 11).
//
// Tipografía (medida en scripts/diagnose-type.ts, comparada en screenshots/type/): el glifo se
// dimensiona por el alto real de su tinta, la celda se alinea al píxel de dispositivo y NO se
// estira en X. Las tres cosas juntas son lo que quita el aspecto "grueso y sucio".
//
// Presupuesto de 4 ms/frame (§8): repintar las ~6000 celdas cuesta ~11 ms, así que NUNCA se
// repinta todo en un frame de animación. Cada tipo de cambio toca solo lo suyo:
//   shimmer  → las ~180 celdas que cambiaron de glifo
//   reveal   → únicamente las filas nuevas
//   puntero  → el rectángulo que cubre la posición anterior y la nueva
//   modo color → composición de dos canvas ya pintados (fallback previsto en §6.3 punto 11)

import { gsap, ScrollTrigger } from '../../core/gsap.ts';
import { clamp, lerp, prefersReducedMotion, type Module } from '../../core/utils.ts';
import { charForLuma, denseChar } from './charRamp.ts';

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
}

const ALPHA_STEPS = 8;
const SHIMMER_MS = 120;
const SHIMMER_RATE = 0.03;
const FADE_DURATION = 0.9;
/** Sobremuestreo del canvas intermedio donde se aplica el desenfoque. */
const SMOOTH_SS = 2;

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
  private chars: string[] = [];
  private buckets: Bucket[] = [];

  // Estado
  private revealRow = 0;
  private drawnRow = 0;
  private colorMix = 0;
  private mode: 'ascii' | 'color' = 'ascii';
  private pointerX = -999;
  private pointerY = -999;
  private targetX = -999;
  private targetY = -999;
  private hasPointer = false;
  private lastShimmer = 0;
  private shimmerDirty: number[] = [];
  private running = false;
  private visible = true;
  private ready = false;
  private revealRequested = false;
  private frameCount = 0;
  private frameMs = 0;
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

  private accent: [number, number, number];
  private fg: [number, number, number];

  private observer: IntersectionObserver | null = null;
  private triggers: ScrollTrigger[] = [];
  private readonly onTick = (): void => this.frame();

  constructor(canvas: HTMLCanvasElement, options: AsciiOptions) {
    this.canvas = canvas;

    const { onModeChange, ...rest } = options;
    this.opts = {
      // Grid MEDIDO en la referencia (scripts/measure-grid.ts): 7.56 px, celdas cuadradas.
      cellW: 7.56,
      cellH: 7.56,
      // 0 = automático: se deduce del alto real de la tinta para que el glifo quepa en la celda
      fontSize: 0,
      pointerRadius: 6,
      contrast: 1.4,
      // Calibrados contra la proporción de highlights medida en la referencia (24 % de las
      // celdas con color): esta pareja da 20.3 %. Ver scripts/tune-highlights.ts.
      smooth: 1.0,
      highlightDelta: 0.12,
      interactive: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      pixelSnap: true,
      // Sin estirar (decisión de Javier tras comparar en screenshots/type/): el estirado ×1.67
      // engordaba los trazos verticales y era la causa principal del aspecto "grueso y sucio".
      // La contrapartida: el glifo ocupa ~60 % del ancho, así que la celda es cuadrada como
      // rejilla pero no como mancha de tinta.
      stretch: false,
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

    this.accent = hexToRgb(readToken('--accent', '#39ff6a'));
    this.fg = hexToRgb(readToken('--fg', '#eeeeee'));

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
      this.revealRow = this.rows;
      this.drawnRow = 0;
      this.paintRows(0, this.rows);
      this.drawnRow = this.rows;
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

    this.revealRow = 0;
    this.drawnRow = 0;
    this.canvas.dataset.reveal = '0';
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    gsap.fromTo(
      this,
      { revealRow: 0 },
      { revealRow: this.rows, duration: 1.4, ease: 'main', overwrite: true },
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

      const style = this.styleFor(i, l, mix);
      let list = map.get(style);
      if (!list) {
        list = [];
        map.set(style, list);
      }
      list.push(i);
    }

    return [...map].map(([style, cells]) => ({ style, cells: Int32Array.from(cells) }));
  }

  private styleFor(i: number, l: number, mix: number): string {
    const isHi = this.highlight[i] === 1;
    const base = isHi ? this.fg : this.accent;
    const alpha = isHi ? 0.9 + 0.1 * l : 0.35 + 0.55 * l;

    if (mix <= 0) return this.rgba(base[0], base[1], base[2], alpha);

    const r = this.rgb[i * 3] ?? 0;
    const g = this.rgb[i * 3 + 1] ?? 0;
    const b = this.rgb[i * 3 + 2] ?? 0;

    return this.rgba(
      lerp(base[0], r, mix),
      lerp(base[1], g, mix),
      lerp(base[2], b, mix),
      lerp(alpha, 0.55 + 0.45 * l, mix),
    );
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

  /** Pinta las filas [from, to) agrupando por estilo. Lo usa el reveal, fila a fila. */
  private paintRows(from: number, to: number, ctx = this.ctx): void {
    if (to <= from) return;
    this.prepare(ctx);

    const cellH = this.ch;
    const stepX = this.stepX;

    for (const bucket of this.buckets) {
      ctx.fillStyle = bucket.style;
      const cells = bucket.cells;

      for (let k = 0; k < cells.length; k++) {
        const i = cells[k] ?? 0;
        const y = this.cellY[i] ?? 0;
        if (y < from || y >= to) continue;
        ctx.fillText(this.chars[i] ?? '', (this.cellX[i] ?? 0) * stepX, y * cellH);
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
    const reveal = Math.floor(this.revealRow);

    for (const i of indices) {
      const y = this.cellY[i] ?? 0;
      if (y >= reveal) continue;

      const x = this.cellX[i] ?? 0;
      const px = x * stepX;
      const py = y * cellH;

      ctx.clearRect(px, py, stepX, cellH);

      const l = this.luma[i] ?? 0;
      if (l < 0.12) continue;

      ctx.fillStyle = this.styleFor(i, l, this.colorMix);
      ctx.fillText(this.chars[i] ?? '', px, py);
    }
  }

  /** Repinta el rectángulo que cubre la posición anterior y la actual del puntero. */
  private paintPointerRegion(prevX: number, prevY: number): void {
    const ctx = this.ctx;
    const cellH = this.ch;
    const pad = this.opts.pointerRadius + 1;
    const cols = this.cols;
    const reveal = Math.floor(this.revealRow);

    const minX = Math.max(0, Math.floor(Math.min(prevX, this.pointerX) - pad));
    const maxX = Math.min(cols - 1, Math.ceil(Math.max(prevX, this.pointerX) + pad));
    const minY = Math.max(0, Math.floor(Math.min(prevY, this.pointerY) - pad));
    const maxY = Math.min(this.rows - 1, Math.ceil(Math.max(prevY, this.pointerY) + pad));
    if (maxX < minX || maxY < minY) return;

    this.prepare(ctx);
    const stepX = this.stepX;
    ctx.clearRect(minX * stepX, minY * cellH, (maxX - minX + 1) * stepX, (maxY - minY + 1) * cellH);

    const px = this.pointerX;
    const py = this.pointerY;
    const radius = this.opts.pointerRadius;
    const pointerOn = this.hasPointer && px > -100;

    for (let y = minY; y <= maxY; y++) {
      if (y >= reveal) continue;

      for (let x = minX; x <= maxX; x++) {
        const i = y * cols + x;
        const l = this.luma[i] ?? 0;
        if (l < 0.12) continue;

        const dist = pointerOn ? Math.hypot(x - px, y - py) : Infinity;

        if (dist <= radius) {
          // §6.3 punto 8: se eleva la luminancia, se aclara hacia --fg y se densifica el glifo
          const falloff = 1 - dist / radius;
          const lifted = clamp(l + 0.35 * falloff, 0, 1);
          ctx.fillStyle = this.rgba(this.fg[0], this.fg[1], this.fg[2], 0.4 + 0.6 * falloff);
          // El ripple va en el espacio ya estirado, por eso se divide por el factor
          const dx = (Math.sin((y + this.lastShimmer * 0.002) * 1.7) * 2 * falloff * stepX) / this.cw;
          ctx.fillText(denseChar(lifted, i, this.salt[i] ?? 0), x * stepX + dx, y * cellH);
        } else {
          ctx.fillStyle = this.styleFor(i, l, this.colorMix);
          ctx.fillText(this.chars[i] ?? '', x * stepX, y * cellH);
        }
      }
    }
  }

  /** Repinta el retrato completo. Solo en momentos puntuales, nunca por frame. */
  private paintAll(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.paintRows(0, Math.floor(this.revealRow));
    this.drawnRow = Math.floor(this.revealRow);
  }

  // ---------------------------------------------------------------- ciclo

  private attach(): void {
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);

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
    this.revealRow = this.rows;
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
    this.paintRows(0, Math.floor(this.revealRow), ctx);
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

    // 1) Reveal: solo las filas nuevas desde el último frame
    const reveal = Math.floor(this.revealRow);
    if (reveal > this.drawnRow) {
      this.paintRows(this.drawnRow, reveal);
      this.drawnRow = reveal;
      painted = true;
      // Progreso observable: lo leen ?debug y check-phase3 sin tener que releer el canvas
      this.canvas.dataset.reveal = (reveal / this.rows).toFixed(3);
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

    this.frameMs = painted ? performance.now() - started : 0;

    if (++this.frameCount % 10 === 0) {
      this.canvas.dataset.frameMs = this.frameMs.toFixed(2);
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
    this.revealRow = this.rows;
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
