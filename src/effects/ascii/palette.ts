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

type RGB = readonly [number, number, number];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Cortes de Otsu (k=4) sobre la luminancia por celda. Medidos, no estimados. */
export const CORTES = [0.328, 0.523, 0.727] as const;

export type PaletteMode = 'photo' | 'bands' | 'ramp' | 'rampa11' | 'poster' | 'snap';

/**
 * RAMPA DE 11 TONOS de Javier (checkpoint B, 2026-09-09). Sustituye al RGB literal de la foto
 * y a las anclas derivadas de Otsu. Es la fuente única: el shader la recibe de aquí.
 *
 * MEDIDA antes de aplicarla (`scripts/measure-rampa.ts`), porque tiene una propiedad que
 * decide cómo se implementa:
 *
 *     #   hex        t      luminancia   croma
 *     0   #000000   0.000     0.0000     0.000
 *     1   #1C0F08   0.100     0.0677     0.078
 *     2   #421F09   0.200     0.1445     0.224
 *     3   #6C3A13   0.300     0.2581     0.349
 *     4   #98581A   0.400     0.3809     0.494
 *     5   #C67E26   0.500     0.5292     0.627
 *     6   #DFAC50   0.600     0.6910     0.561
 *     7   #F2DB8E   0.700     0.8562     0.392
 *     8   #978E7D   0.800     0.5596     0.102   <-- la luminancia CAE un 35 %
 *     9   #BFBCB3   0.900     0.7372     0.047
 *    10   #F1F0EA   1.000     0.9403     0.027
 *
 * O sea: NO es monótona, y son dos familias. Del 0 al 7 una rampa cálida que sube limpia
 * (tono 21° -> 46°, croma hasta 0.63); del 8 al 10, grises neutros. Repartiéndolos a
 * intervalos iguales en t —que es la instrucción literal— hay una inversión tonal en t=0.80:
 * el retrato se oscurece y se dessatura justo al subir de luminancia.
 *
 * Cuánto importa eso está medido en `scripts/measure-reparto.ts`: **el 38.7 % del dibujo cae
 * por encima de t=0.7** y el 14.4 % justo en el tramo de la inversión. No es una esquina.
 */
export const RAMPA: readonly RGB[] = [
  [0, 0, 0], // #000000
  [28, 15, 8], // #1C0F08
  [66, 31, 9], // #421F09
  [108, 58, 19], // #6C3A13
  [152, 88, 26], // #98581A
  [198, 126, 38], // #C67E26
  [223, 172, 80], // #DFAC50
  [242, 219, 142], // #F2DB8E
  [151, 142, 125], // #978E7D
  [191, 188, 179], // #BFBCB3
  [241, 240, 234], // #F1F0EA
];

/** Escalones por defecto de la versión posterizada, para la comparativa del checkpoint B. */
export const POSTER_ESCALONES = 5;

/** Dónde deja de ser cálida y empieza la familia neutra. Medido por croma (< 0.11). */
export const RAMPA_CALIDA_HASTA = 7;

/**
 * Posición de cada punto en t. NO son intervalos iguales, y esa es la decisión de Javier del
 * 2026-09-09: **la familia neutra empieza en t>0.90, no en t>0.70**.
 *
 * Por qué importa: repartidos a intervalos iguales, el 38.7 % del dibujo caía en los tres
 * grises y el retrato leía PLATEADO en vez de cálido (medido en `measure-reparto.ts`).
 * Comprimiendo los neutros al 10 % más alto, la rampa cálida cubre el 90 % del rango y los
 * grises quedan donde deben: en los brillos.
 */
export const POSICIONES: readonly number[] = [
  0, 0.1286, 0.2571, 0.3857, 0.5143, 0.6429, 0.7714, 0.9, 0.9333, 0.9667, 1,
];

/**
 * Tono FRÍO de la coronilla. Medido por Javier sobre los píxeles de su referencia: el azul de
 * la cabeza/oreja NO es un celeste brillante, es un **teal medio-oscuro**, de #224657 (media de
 * la zona) a #43839E (los píxeles más claros). #2E5670 es el punto medio de ese rango.
 *
 * Y va en una BANDA MEDIA, no en el pico de blanco. El primer intento de este proyecto puso un
 * azul en la banda más OSCURA y no se leía (ver la nota de más abajo); el segundo lo puso en la
 * más ALTA y se comió el retrato —el 50 % de la tinta pintada— porque la curva de contraste
 * satura ahí el 34.7 % del dibujo. En medio es donde está la coronilla de nuestro jaguar:
 * medido en `measure-cabeza.ts`, los bloques de la parte alta de la cabeza tienen luminancia
 * media 0.63–0.77.
 *
 * Luminancia de #2E5670: 0.311. En banda media el alpha del modo color es ~0.86, así que en
 * pantalla sale ~4x más luminoso que el azul oscuro que se descartó (que caía con alpha ~0.32).
 */
export const FRIO_ALTO: RGB = [46, 86, 112];

/**
 * Color del highlight cuando se pide que pertenezca a la paleta en vez de usar `--fg`.
 * Es el neutro cálido de la propia rampa: medido, es visualmente idéntico al blanco que
 * sustituye (cálidas 120007 vs 119598), así que quita la duplicación sin coste.
 */
export const HIGHLIGHT_NEUTRO: RGB = [241, 240, 234];

/**
 * Color de la rampa para una luminancia, interpolando entre los 11 puntos. Gradiente continuo,
 * no bandas: los puntos se reparten a intervalos iguales en t, que es la instrucción.
 */
export function colorRampa(l: number, frio = false): RGB {
  const x = Math.min(1, Math.max(0, l));
  const punto = (i: number): RGB => (frio && i === RAMPA.length - 1 ? FRIO_ALTO : (RAMPA[i] ?? RAMPA[0]!));
  let i = 0;
  while (i < POSICIONES.length - 2 && x > (POSICIONES[i + 1] ?? 1)) i++;
  const t0 = POSICIONES[i] ?? 0;
  const t1 = POSICIONES[i + 1] ?? 1;
  const f = t1 > t0 ? (x - t0) / (t1 - t0) : 0;
  const a = punto(i);
  const b = punto(i + 1);
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

/**
 * Separar la MANDÍBULA del BRILLO PUNTUAL, que hoy se leen con el mismo blanco.
 *
 * MEDIDO antes de aplicarlo (`scripts/measure-mandibula.ts`), porque hay dos caminos distintos
 * al mismo color y solo uno es un brillo: al punto más alto de la rampa se llega **por
 * luminancia** (`colorSnap` manda ahí todo lo que pasa de t=0.9833) y **por highlight** (la
 * capa de `hlModo 2` pinta ese mismo color donde el contraste local es alto). En la zona de la
 * mandíbula son **503 celdas en el tope, y solo 71 son highlight de verdad: el 85.9 % llega
 * por luminancia**. O sea que la estructura y el brillo se estaban fundiendo en el mismo punto.
 *
 * Con esto, el tope queda para el brillo y la estructura cae al escalón que se elija. `baja`
 * dice cuántos: 1 -> `#BFBCB3`, 2 -> `#978E7D`, 3 -> el crema `#F2DB8E`.
 */
export interface SeparacionHighlight {
  /** Reservar el punto más alto para las celdas de highlight real. */
  reservarTope: boolean;
  /** Escalones que baja lo que llega al tope SIN ser highlight. */
  baja: number;
  /** Si esta celda es highlight (contraste local alto), que es lo que el shader ya calcula. */
  hi: boolean;
}

/**
 * La rampa cuantizada a sus PROPIOS puntos: `l` se lleva a la POSICION más cercana, así que la
 * salida es siempre uno de los 11 colores, sin interpolar.
 *
 * Por qué existe (2026-09-09, medido en `measure-hocico-comps.ts`): posterizar en `n` escalones
 * cuantiza `l` a la rejilla uniforme `k/(n-1)`, y las POSICIONES **no** son uniformes. Con n=5
 * solo dos escalones (0 y 1) caen sobre un punto de la rampa; los otros tres aterrizan a mitad
 * de tramo y salen colores INTERPOLADOS, que no son los de Javier. Subir a 6 o 7 escalones no
 * arregla eso —solo cambia dónde caen las mezclas—, así que hay puntos de la rampa que ninguna
 * `n` puede producir. Snapping a las POSICIONES sí: cada punto tiene su intervalo (el de los
 * vecinos a mitad de camino) y aparece en cuanto la luminancia cae dentro.
 */
export function colorSnap(l: number, frio = false, sep?: SeparacionHighlight): RGB {
  const x = Math.min(1, Math.max(0, l));
  let mejor = 0;
  let d = Infinity;
  for (let i = 0; i < POSICIONES.length; i++) {
    const dd = Math.abs(x - (POSICIONES[i] ?? 0));
    if (dd < d) {
      d = dd;
      mejor = i;
    }
  }
  // El tope se reserva para el BRILLO PUNTUAL: lo que llega ahí solo por luminancia baja un
  // escalón (o los que se pidan). Ver `SeparacionHighlight`.
  if (sep?.reservarTope && !sep.hi && mejor === RAMPA.length - 1) {
    mejor = Math.max(0, mejor - (sep.baja ?? 1));
  }
  if (frio && mejor === RAMPA.length - 1) return FRIO_ALTO;
  return RAMPA[mejor] ?? RAMPA[0]!;
}

/**
 * La MISMA rampa posterizada en `n` escalones. Para comparar contra la continua: la rampa
 * describe una gradación, pero el retrato es ASCII y el glifo ya posteriza la densidad; puede
 * que el color pida lo mismo. Se decide viendo las dos.
 */
export function colorPosterizado(l: number, n: number, frio = false): RGB {
  const paso = Math.max(1, n - 1);
  const q = Math.round(Math.min(1, Math.max(0, l)) * paso) / paso;
  return colorRampa(q, frio);
}

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
export function colorDe(modo: Exclude<PaletteMode, 'photo'>, l: number): RGB {
  // La rampa de 11 tonos entra por aquí para que los DOS motores compartan fuente de verdad:
  // si el Canvas 2D siguiera con las anclas de Otsu, la comparación de paridad dejaría de
  // significar nada en cuanto se cambiara la paleta.
  if (modo === 'rampa11') return colorRampa(l);
  if (modo === 'poster') return colorPosterizado(l, POSTER_ESCALONES);
  if (modo === 'snap') return colorSnap(l);

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
