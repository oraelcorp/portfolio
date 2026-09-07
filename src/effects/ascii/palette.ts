// src/effects/ascii/palette.ts — paleta multi-tono del modo color. Fase 8, parte 1.
//
// Por qué existe: el modo color usaba el RGB literal de la foto y salía pardo apagado. Está
// MEDIDO por qué (scripts/recon-palette.ts): el sujeto entero cabe en 11° de tono —de 20° a
// 31° entre la banda más oscura y la más clara—, así que no hay color que revelar. Lo que se
// hace aquí no es extraer color de la foto: es MAPEAR su luminancia a una rampa diseñada.
//
// Los cortes NO están elegidos a ojo: salen de Otsu multinivel sobre el histograma por celda
// (scripts/recon-palette.ts). Detalle honesto: el histograma es una meseta suave, sin valles
// —la varianza entre clases solo mejora un 1.4 % de 3 bandas a 5—, así que Otsu converge
// prácticamente a los cuartiles. Esos son los cortes que los datos sostienen; fingir que hay
// estructura donde no la hay habría sido inventarse los cortes.

/** Cortes de Otsu (k=4) sobre la luminancia por celda. Medidos, no estimados. */
export const CORTES = [0.328, 0.523, 0.727] as const;

export type PaletteMode = 'photo' | 'bands' | 'ramp';

type RGB = readonly [number, number, number];

/**
 * Anclas de la rampa, una por banda. Frío en la sombra, cobre y ámbar en los medios, blanco
 * cálido en las altas: es la relación con la luminancia que se lee en la imagen de referencia
 * que pasó Javier (lectura visual, no medición: no tengo el archivo original).
 * La banda 0 traza los CONTORNOS de las rosetas y la silueta —se ve en el mapa de bandas—,
 * así que darle un frío profundo es lo que dibuja el felino en vez de ensuciarlo.
 */
export const ANCLAS: readonly RGB[] = [
  [124, 46, 22], // 0.12–0.328 · siena quemada: rosetas y silueta
  [206, 94, 32], // 0.328–0.523 · cobre
  [245, 172, 56], // 0.523–0.727 · ámbar, el tono dominante
  [255, 242, 214], // 0.727–1 · blanco cálido, donde caen la mitad de los highlights
];

// PRIMER INTENTO, descartado y anotado para no repetirlo: la banda 0 era un azul profundo
// [31,58,107], buscando el frío de la referencia. NO SE LEE — es el 24 % de las celdas y son
// justo las de menor luminancia, así que sobre negro pasan por sombra y ese cuarto del
// retrato no aportaba nada. El frío de la referencia vive en la coronilla, que es una REGIÓN,
// y aquí no hay región que valga: los componentes medidos son 76, 9, 8, 5, 3 y 1 celdas.
// Si se quiere frío hay que ponerlo como decisión espacial explícita, no derivarlo del tono.

/** Acento de región: el interior del hocico. Rojo intenso, como en la referencia. */
export const ACENTO_HOCICO: RGB = [224, 48, 74];

export interface Regiones {
  hocico: Uint8Array<ArrayBuffer>;
  /** Estadísticas de cada componente conexo, para diagnóstico (`data-regiones` del canvas). */
  comps: Array<{ id: number; n: number; cx: number; cy: number }>;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Índice de banda de una luminancia. */
export function bandaDe(l: number): number {
  if (l < CORTES[0]) return 0;
  if (l < CORTES[1]) return 1;
  if (l < CORTES[2]) return 2;
  return 3;
}

/**
 * Color de la paleta para una luminancia.
 * - `bands`: color plano por banda. Posteriza y marca la estructura del pelaje.
 * - `ramp`: interpola entre anclas consecutivas. Misma familia de color, gradación continua.
 */
export function colorDe(modo: 'bands' | 'ramp', l: number): RGB {
  const b = bandaDe(l);
  if (modo === 'bands') return ANCLAS[b] ?? ANCLAS[3] ?? [255, 255, 255];

  // Posición dentro de la banda, para interpolar hacia la ancla siguiente
  const lo = b === 0 ? 0.12 : (CORTES[b - 1] ?? 0);
  const hi = b === 3 ? 1 : (CORTES[b] ?? 1);
  const t = hi > lo ? Math.min(1, Math.max(0, (l - lo) / (hi - lo))) : 0;
  const a = ANCLAS[b] ?? ANCLAS[3] ?? [255, 255, 255];
  const c = ANCLAS[Math.min(ANCLAS.length - 1, b + 1)] ?? a;
  return [lerp(a[0], c[0], t), lerp(a[1], c[1], t), lerp(a[2], c[2], t)];
}

/**
 * Marca el interior del hocico a partir del TONO de la foto.
 *
 * Se probaron antes las dos señales que ya teníamos y ninguna sirve (medido en
 * scripts/palette-regions.ts): las bandas de luminancia están entrelazadas por todo el pelaje
 * —todos los centroides caen en el mismo punto— y el flag de contraste local es un detector
 * de BORDES, que traza rosetas y bigotes.
 *
 * El tono sí tiene señal: 299 celdas caen en el magenta (300°–10°) y forman un cúmulo denso
 * en el hocico. Pero sueltas dan una dispersión de 0.69 respecto al sujeto —o sea, casi tan
 * repartidas como él— por el ruido de la derecha, así que hace falta el filtro espacial:
 * erosión para matar lo disperso, componentes conexas, y quedarse con la mayor.
 *
 * @returns las máscaras de hocico y corona, más las estadísticas de cada componente.
 */
export function detectarRegiones(
  rgb: Uint8ClampedArray,
  luma: Float32Array,
  cols: number,
  rows: number,
  inkFloor: number,
): Regiones {
  const total = cols * rows;
  const cand = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    if ((luma[i] ?? 0) < inkFloor) continue;
    const r = (rgb[i * 3] ?? 0) / 255;
    const g = (rgb[i * 3 + 1] ?? 0) / 255;
    const b = (rgb[i * 3 + 2] ?? 0) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) continue;
    // Las tres ramas asignan siempre, así que inicializar a 0 sería un valor muerto
    const sector = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const h = (sector * 60 + 360) % 360;
    if (h >= 300 || h < 10) cand[i] = 1;
  }

  // Erosión: una celda sobrevive solo si tiene al menos 3 vecinas candidatas. Es lo que
  // separa el cúmulo del hocico del salpicado suelto por el flanco.
  const erosion = new Uint8Array(total);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (cand[i] !== 1) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (cand[ny * cols + nx] === 1) n++;
        }
      }
      if (n >= 3) erosion[i] = 1;
    }
  }

  // Componentes conexas: el hocico es la mayor. Lo demás, fuera.
  const etiqueta = new Int32Array(total).fill(-1);
  const tam: number[] = [];
  const pila: number[] = [];
  for (let s = 0; s < total; s++) {
    if (erosion[s] !== 1 || etiqueta[s] !== -1) continue;
    const id = tam.length;
    let n = 0;
    pila.length = 0;
    pila.push(s);
    etiqueta[s] = id;
    while (pila.length > 0) {
      const i = pila.pop() ?? 0;
      n++;
      const x = i % cols;
      const y = (i - x) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (erosion[j] === 1 && etiqueta[j] === -1) {
            etiqueta[j] = id;
            pila.push(j);
          }
        }
      }
    }
    tam.push(n);
  }
  if (tam.length === 0) return { hocico: new Uint8Array(total), comps: [] };

  // Estadísticas por componente, para elegir con datos en vez de a ojo
  const comps = tam.map((n, id) => {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < total; i++) {
      if (etiqueta[i] !== id) continue;
      sx += (i % cols) / cols;
      sy += Math.floor(i / cols) / rows;
    }
    return { id, n, cx: sx / n, cy: sy / n };
  });

  let mayor = 0;
  for (let i = 1; i < tam.length; i++) if ((tam[i] ?? 0) > (tam[mayor] ?? 0)) mayor = i;

  // MEDIDO: no hay segunda región. Los componentes son 76, 9, 8, 5, 3 y 1 celdas, y todos los
  // pequeños caen en la franja media (y ≈ 0.43–0.58), no en la coronilla. Los rosas que se
  // veían en el borde superior del mapa de tono eran un reborde de UNA celda de ancho y la
  // erosión se los comió, que es justo lo que la erosión debe hacer con el ruido de contorno.
  // Por eso el acento frío de la referencia no se replica aquí: no hay dónde ponerlo.

  // Dilatación de una celda: la erosión comió el borde del cúmulo y sin esto el acento
  // queda un anillo más pequeño que la boca real.
  const dilatar = (id: number): Uint8Array<ArrayBuffer> => {
    const salida = new Uint8Array(total);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (etiqueta[y * cols + x] !== id) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const j = ny * cols + nx;
            // Solo sobre celdas que se dibujan: no ensanchar la región sobre el fondo
            if ((luma[j] ?? 0) >= inkFloor) salida[j] = 1;
          }
        }
      }
    }
    return salida;
  };

  return { hocico: dilatar(mayor), comps: comps.sort((a, b) => b.n - a.n) };
}
