// scripts/lib/frente.ts — medir un FRENTE DE ONDA radial, con la misma vara aquí y en la
// referencia.
//
// La pregunta de Javier es "¿por qué la onda se siente mecánica?", y eso no se contesta con una
// captura: hay que mirar CÓMO avanza el frente. Dos cosas lo definen y las dos se miden:
//
//   GROSOR — para cada fotograma, las celdas que acaban de encenderse. Si el frente es un
//            círculo perfecto, todas están a la misma distancia del origen y la desviación
//            típica de esa distancia es solo la cuantización del fotograma (velocidad × 16 ms).
//            Si el frente está perturbado, la desviación SUBE por encima de esa cuantización, y
//            la diferencia es exactamente la amplitud del ruido, en celdas.
//   CURVA  — el radio mediano de esas celdas contra el tiempo. Es el ease de la animación, que
//            se puede comparar contra `cubic.out`, `quad.out` o lo que sea.
//
// El origen no se supone: se BUSCA, quedándose con el que minimiza el grosor. Así la medida
// vale igual para nuestra onda (donde el origen se conoce) que para la referencia (donde no).

/**
 * Código que corre EN LA PÁGINA. Graba en qué milisegundo se enciende cada celda de una rejilla
 * de `ancho`×`alto`, muestreando el canvas una vez por frame.
 *
 * Se muestrea a rejilla gruesa a propósito: lo que se mide es la forma del frente, no el glifo,
 * y bajar la resolución mantiene el coste por frame en el orden del milisegundo para no alterar
 * lo mismo que se está midiendo.
 */
export const GRABAR_FRENTE = `(({ ms, ancho, alto, umbral, selector }) => new Promise((resolve) => {
  const c = document.querySelector(selector);
  const off = document.createElement('canvas');
  off.width = ancho; off.height = alto;
  const x = off.getContext('2d', { willReadFrequently: true });
  const llegada = new Float64Array(ancho * alto).fill(-1);
  const t0 = performance.now();
  const paso = () => {
    const t = performance.now() - t0;
    x.clearRect(0, 0, ancho, alto);
    x.drawImage(c, 0, 0, ancho, alto);
    const d = x.getImageData(0, 0, ancho, alto).data;
    for (let i = 0; i < ancho * alto; i++) {
      if (llegada[i] >= 0) continue;
      const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2];
      if (0.2126 * R + 0.7152 * G + 0.0722 * B >= umbral) llegada[i] = t;
    }
    if (t < ms) requestAnimationFrame(paso);
    else resolve({ llegada: Array.from(llegada), ancho, alto });
  };
  requestAnimationFrame(paso);
}))`;

/**
 * Expresión lista para `page.evaluate`. Hace falta porque `evaluate` con una CADENA la evalúa
 * como expresión y **no le pasa los argumentos**: hay que incrustarlos.
 */
export function grabarFrenteExpr(opts: {
  ms: number;
  ancho: number;
  alto: number;
  umbral: number;
  selector: string;
}): string {
  return `${GRABAR_FRENTE}(${JSON.stringify(opts)})`;
}

/**
 * Frente a partir de una secuencia de fotogramas en GRIS CRUDO (lo que escupe
 * `ffmpeg -pix_fmt gray -f rawvideo`), un fotograma detrás de otro.
 *
 * Por qué por vídeo y no leyendo el canvas: **un canvas WebGL sin `preserveDrawingBuffer` se
 * lee NEGRO desde fuera de su propio frame de dibujo**. Medido contra la referencia: el
 * muestreo por `drawImage` daba negro durante toda la animación y de golpe 2316 celdas en un
 * solo fotograma a los 6.9 s — justo cuando el sitio deja de repintar. O sea que se perdía
 * exactamente lo que se quería medir. El vídeo lo graba el compositor, así que ve lo mismo que
 * el ojo.
 */
export function frenteDesdeGray(
  buf: Buffer,
  ancho: number,
  alto: number,
  fps: number,
  umbral: number,
  desdeFrame = 0,
): Frente {
  const porFrame = ancho * alto;
  const nFrames = Math.floor(buf.length / porFrame);
  const llegada = new Array<number>(porFrame).fill(-1);
  for (let f = desdeFrame; f < nFrames; f++) {
    const base = f * porFrame;
    const t = ((f - desdeFrame) * 1000) / fps;
    for (let i = 0; i < porFrame; i++) {
      if (llegada[i]! >= 0) continue;
      if ((buf[base + i] ?? 0) >= umbral) llegada[i] = t;
    }
  }
  return { llegada, ancho, alto };
}

/** Luminancia media de cada fotograma. Sirve para situar dónde empieza lo que interesa. */
export function mediasPorFrame(buf: Buffer, ancho: number, alto: number): number[] {
  const porFrame = ancho * alto;
  const n = Math.floor(buf.length / porFrame);
  const out: number[] = [];
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = 0; i < porFrame; i++) s += buf[f * porFrame + i] ?? 0;
    out.push(s / porFrame);
  }
  return out;
}

/**
 * Fotograma donde EMPIEZA la transición: el más oscuro dentro de la ventana de búsqueda.
 *
 * Hace falta porque el vídeo empieza antes que el efecto — en la referencia, con el preloader
 * tapando la pantalla entera, y aquí con el nuestro. El lienzo vacío es el punto más oscuro de
 * toda la grabación, así que es un ancla objetiva y no un "más o menos por aquí".
 */
export function frameDeArranque(medias: number[], hasta = 0.7): number {
  const fin = Math.max(1, Math.floor(medias.length * hasta));
  let mejor = 0;
  for (let i = 1; i < fin; i++) if ((medias[i] ?? 0) < (medias[mejor] ?? 0)) mejor = i;
  return mejor;
}

export interface Frente {
  llegada: number[];
  ancho: number;
  alto: number;
}

export interface AnalisisFrente {
  ox: number;
  oy: number;
  /** Celdas que llegaron alguna vez. */
  n: number;
  /** Grosor del frente: mediana, por fotograma, de la sd de la distancia al origen. */
  grosor: number;
  /** Cuantización esperada por muestrear a 60 Hz: velocidad × intervalo, en celdas. */
  cuantizacion: number;
  /** Grosor menos cuantización. Es lo que NO explica el muestreo: la perturbación real. */
  perturbacion: number;
  /** Radio mediano del frente en cada fotograma con llegadas: [ms, radio]. */
  curva: Array<[number, number]>;
  /** Duración desde la primera llegada hasta la última. */
  duracionMs: number;
}

/** Agrupa las llegadas por fotograma (los tiempos ya vienen cuantizados por rAF). */
function porFotograma(f: Frente): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (let i = 0; i < f.llegada.length; i++) {
    const t = f.llegada[i] ?? -1;
    if (t < 0) continue;
    const k = Math.round(t);
    const lista = m.get(k) ?? [];
    lista.push(i);
    m.set(k, lista);
  }
  return m;
}

function sd(v: number[]): number {
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

function mediana(v: number[]): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * Grosor medio del frente para un origen dado. Solo entran los fotogramas con suficientes
 * llegadas: los de dos o tres celdas sueltas son ruido de umbral, no frente.
 */
function grosorPara(f: Frente, ox: number, oy: number, minCeldas: number): number {
  const frames = porFotograma(f);
  const sds: number[] = [];
  for (const [, idx] of frames) {
    if (idx.length < minCeldas) continue;
    const ds = idx.map((i) => {
      const x = i % f.ancho;
      const y = (i - x) / f.ancho;
      return Math.hypot(x - ox, y - oy);
    });
    sds.push(sd(ds));
  }
  return sds.length ? mediana(sds) : Infinity;
}

/**
 * Analiza un frente: busca el origen que lo hace más compacto y devuelve grosor, curva y la
 * parte del grosor que NO explica el muestreo.
 *
 * @param minCeldas fotogramas con menos llegadas que esto no cuentan (ruido de umbral).
 */
export function analizarFrente(f: Frente, minCeldas = 12): AnalisisFrente {
  // Búsqueda del origen: rejilla gruesa sobre todo el lienzo y luego afinado local. El origen
  // puede caer FUERA del lienzo (una onda que entra por una esquina), así que el margen es
  // generoso a propósito.
  let mejor = { ox: f.ancho / 2, oy: f.alto / 2, g: Infinity };
  for (let oy = -f.alto; oy <= 2 * f.alto; oy += Math.max(2, Math.round(f.alto / 12))) {
    for (let ox = -f.ancho; ox <= 2 * f.ancho; ox += Math.max(2, Math.round(f.ancho / 12))) {
      const g = grosorPara(f, ox, oy, minCeldas);
      if (g < mejor.g) mejor = { ox, oy, g };
    }
  }
  for (let paso = Math.max(2, Math.round(f.alto / 12)); paso >= 1; paso = Math.floor(paso / 2)) {
    for (let dy = -paso; dy <= paso; dy++) {
      for (let dx = -paso; dx <= paso; dx++) {
        const ox = mejor.ox + dx;
        const oy = mejor.oy + dy;
        const g = grosorPara(f, ox, oy, minCeldas);
        if (g < mejor.g) mejor = { ox, oy, g };
      }
    }
    if (paso === 1) break;
  }

  const frames = [...porFotograma(f).entries()].sort((a, b) => a[0] - b[0]);
  const curva: Array<[number, number]> = [];
  for (const [t, idx] of frames) {
    if (idx.length < minCeldas) continue;
    const ds = idx.map((i) => {
      const x = i % f.ancho;
      const y = (i - x) / f.ancho;
      return Math.hypot(x - mejor.ox, y - mejor.oy);
    });
    curva.push([t, mediana(ds)]);
  }

  // Cuantización: cuánto avanza el frente entre dos muestras. Es el suelo del grosor — un
  // frente perfectamente circular medido a 60 Hz ya sale "grueso" por esto.
  let vel = 0;
  for (let i = 1; i < curva.length; i++) {
    const dt = (curva[i]![0] ?? 0) - (curva[i - 1]![0] ?? 0);
    const dr = (curva[i]![1] ?? 0) - (curva[i - 1]![1] ?? 0);
    if (dt > 0) vel = Math.max(vel, Math.abs(dr));
  }
  const cuantizacion = vel / Math.sqrt(12); // sd de una uniforme de ancho `vel`

  const n = f.llegada.filter((t) => t >= 0).length;
  const t0 = curva.length ? (curva[0]![0] ?? 0) : 0;
  const t1 = curva.length ? (curva[curva.length - 1]![0] ?? 0) : 0;
  return {
    ox: mejor.ox,
    oy: mejor.oy,
    n,
    grosor: mejor.g,
    cuantizacion,
    perturbacion: Math.max(0, mejor.g - cuantizacion),
    curva,
    duracionMs: t1 - t0,
  };
}

/**
 * RESIDUO RADIAL: cuánto se aparta cada celda del círculo que le tocaría.
 *
 * Es la vara buena cuando el origen y los radios se CONOCEN —el barrido de `measure-onda.ts`—,
 * en vez de la búsqueda de origen de `analizarFrente`, que hace falta cuando se mide un sitio
 * ajeno. Para cada celda: distancia real al origen menos el radio del paso en que entró. La
 * desviación típica de esa diferencia es, directamente, la amplitud de la perturbación en
 * celdas; un círculo perfecto deja solo el suelo de la discretización (media celda y el ancho
 * del paso).
 */
export function residuoRadial(
  f: Frente,
  ox: number,
  oy: number,
  radioDe: (paso: number) => number,
): { residuo: number; suelo: number; n: number } {
  const dif: number[] = [];
  for (let i = 0; i < f.llegada.length; i++) {
    const s = f.llegada[i] ?? -1;
    if (s < 0) continue;
    const x = i % f.ancho;
    const y = (i - x) / f.ancho;
    dif.push(Math.hypot(x - ox, y - oy) - radioDe(s));
  }
  const anchoPaso = Math.abs(radioDe(1) - radioDe(0));
  return {
    residuo: sd(dif),
    // Suelo: un frente perfecto ya reparte las llegadas dentro del ancho de un paso.
    suelo: Math.sqrt(anchoPaso ** 2 / 12 + 1 / 12),
    n: dif.length,
  };
}

/**
 * Ajusta el ease de la curva radio-tiempo contra las familias habituales y devuelve la mejor.
 * Se normaliza en los dos ejes, así que compara FORMA, no duración ni tamaño.
 */
export function ajustarEase(curva: Array<[number, number]>): { nombre: string; error: number } {
  if (curva.length < 4) return { nombre: '—', error: Infinity };
  const t0 = curva[0]![0]!;
  const t1 = curva[curva.length - 1]![0]!;
  const r0 = curva[0]![1]!;
  const r1 = curva[curva.length - 1]![1]!;
  if (t1 <= t0 || r1 <= r0) return { nombre: '—', error: Infinity };
  const EASES: Array<[string, (p: number) => number]> = [
    ['lineal', (p) => p],
    ['quad.out', (p) => 1 - (1 - p) ** 2],
    ['cubic.out', (p) => 1 - (1 - p) ** 3],
    ['quart.out', (p) => 1 - (1 - p) ** 4],
    ['expo.out', (p) => (p === 1 ? 1 : 1 - 2 ** (-10 * p))],
    ['quad.inOut', (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2)],
  ];
  let mejor = { nombre: '—', error: Infinity };
  for (const [nombre, fn] of EASES) {
    let err = 0;
    for (const [t, r] of curva) {
      const p = (t - t0) / (t1 - t0);
      err += ((r - r0) / (r1 - r0) - fn(p)) ** 2;
    }
    const e = Math.sqrt(err / curva.length);
    if (e < mejor.error) mejor = { nombre, error: e };
  }
  return mejor;
}
