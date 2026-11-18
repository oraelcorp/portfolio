// scripts/lib/video.ts — grabar el canvas y sacar sus fotogramas, que es la única forma honesta
// de mirar una transición.
//
// Dos usos, y los dos hacen falta: MEDIR (los fotogramas en gris crudo alimentan
// `lib/frente.ts`) y ENSEÑAR (un mp4 que se pueda ver, porque un efecto en movimiento no se
// juzga con capturas).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Envoltorio de `requestAnimationFrame` que entrega una marca de tiempo ESCALADA, para instalar
 * con `addInitScript` (o sea antes de que corra el JS del sitio, que es la única forma de que
 * GSAP nazca ya con el reloj lento).
 *
 * Para qué: contra un sitio ajeno solo se puede grabar por ráfaga de pantallazos, y eso llega a
 * ~15 fps. Un efecto de medio segundo se queda en siete fotogramas, que no dan para leer un
 * desfase. Estirando el tiempo ×4, la misma ráfaga le saca cuatro veces más. Es el mismo truco
 * de estrangular el reloj que se usó con el preloader.
 */
export const RELOJ_LENTO = (factor: number): string => `(() => {
  const raf = window.requestAnimationFrame.bind(window);
  let t0 = null;
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (t0 === null) t0 = t;
    cb(t0 + (t - t0) / ${factor});
  });
})()`;

export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ffmpeg exige dimensiones pares para h264; recortar un píxel es inofensivo. */
function par(n: number): number {
  return n % 2 === 0 ? n : n - 1;
}

function ff(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

/**
 * Extrae los fotogramas de `webm` recortados a `caja`, escalados a `ancho`×`alto`, en gris
 * crudo: un byte por píxel, un fotograma detrás de otro. Es el formato que espera
 * `frenteDesdeGray`.
 */
export function fotogramasGris(
  webm: string,
  caja: Caja,
  ancho: number,
  alto: number,
  fps: number,
  tmpDir: string,
): Buffer {
  mkdirSync(tmpDir, { recursive: true });
  const salida = join(tmpDir, 'frames.gray');
  rmSync(salida, { force: true });
  ff([
    '-i',
    webm,
    '-vf',
    `crop=${par(caja.w)}:${par(caja.h)}:${Math.round(caja.x)}:${Math.round(caja.y)},fps=${fps},scale=${ancho}:${alto}`,
    '-pix_fmt',
    'gray',
    '-f',
    'rawvideo',
    salida,
  ]);
  return readFileSync(salida);
}

/**
 * Ráfaga de capturas del canvas, que es la forma de grabar que SÍ funciona en los dos sitios.
 *
 * `recordVideo` de Playwright se descartó a base de intentarlo: la referencia no llega a pintar
 * su hero con la grabación activa —queda el wipe del preloader a medias y el lienzo en negro los
 * 14 s—, así que no había nada que medir. La captura una a una va a menos fotogramas por segundo
 * (~10-15), pero pasa por el compositor igual que el vídeo y no toca el ciclo de la página.
 *
 * Devuelve los fotogramas en gris crudo y los FPS reales medidos, que no son los pedidos.
 */
export async function rafagaGris(
  page: { screenshot: (o: Record<string, unknown>) => Promise<Buffer> },
  caja: Caja,
  ms: number,
  ancho: number,
  alto: number,
  tmpDir: string,
): Promise<{ buf: Buffer; fps: number; nFrames: number }> {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const clip = { x: caja.x, y: caja.y, width: par(caja.w), height: par(caja.h) };
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms) {
    try {
      const b = await page.screenshot({ clip, type: 'jpeg', quality: 55, animations: 'allow' });
      writeFileSync(join(tmpDir, `f${String(i).padStart(4, '0')}.jpg`), b);
      i++;
    } catch {
      // Una captura perdida no invalida la ráfaga: se corta y se mide con lo grabado. Pasa con
      // sitios de terceros que tumban la pestaña a mitad de grabación.
      break;
    }
  }
  const dur = (Date.now() - t0) / 1000;
  const fps = i / dur;
  const salida = join(tmpDir, 'frames.gray');
  ff([
    '-framerate',
    String(fps),
    '-i',
    join(tmpDir, 'f%04d.jpg'),
    '-vf',
    `scale=${ancho}:${alto}`,
    '-pix_fmt',
    'gray',
    '-f',
    'rawvideo',
    salida,
  ]);
  return { buf: readFileSync(salida), fps, nFrames: i };
}

/** Monta un mp4 a partir de la ráfaga de jpgs, para poder VER lo que se acaba de medir. */
export function rafagaAMp4(tmpDir: string, destino: string, fps: number, anchoMax = 560): void {
  ff([
    '-framerate',
    String(fps),
    '-i',
    join(tmpDir, 'f%04d.jpg'),
    '-vf',
    `scale='min(${anchoMax},iw)':-2:flags=lanczos`,
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    destino,
  ]);
}

/**
 * Convierte el webm de Playwright a un mp4 que se pueda mandar y ver en cualquier sitio,
 * recortado al canvas. `desde`/`dur` acotan el tramo en segundos.
 */
export function aMp4(
  webm: string,
  destino: string,
  caja: Caja,
  opts: { anchoMax?: number; desde?: number; dur?: number } = {},
): void {
  const { anchoMax = 720, desde, dur } = opts;
  const args: string[] = [];
  if (desde !== undefined) args.push('-ss', String(desde));
  args.push('-i', webm);
  if (dur !== undefined) args.push('-t', String(dur));
  args.push(
    '-vf',
    `crop=${par(caja.w)}:${par(caja.h)}:${Math.round(caja.x)}:${Math.round(caja.y)},scale='min(${anchoMax},iw)':-2:flags=lanczos`,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    destino,
  );
  ff(args);
}

/**
 * Fotograma en el que ARRANCA el efecto dentro de un clip, detectado del propio vídeo.
 *
 * Hace falta porque alinear por reloj no funciona: se marcaba el instante del clic con
 * `Date.now()` y los cuatro paneles salían en momentos distintos de la onda —el vídeo empieza a
 * grabar cuando se crea el contexto y el codificador va a lo suyo—. Comparar cuatro clips
 * desfasados no compara nada. Aquí el ancla sale de lo que se ve:
 *
 *   'color'  — fracción de píxeles cálidos (R > G). Sube en cuanto la onda de color entra.
 *   'tinta'  — fracción de píxeles con luz. Sube en cuanto el reveal empieza a dibujar.
 *
 * Se devuelve el primer fotograma que supera la línea base por un margen claro.
 */
export function frameDeMarca(mp4: string, tmpDir: string, saltar = 60): number {
  mkdirSync(tmpDir, { recursive: true });
  const raw = join(tmpDir, 'marca.rgb');
  rmSync(raw, { force: true });
  // La esquina del clip YA ESCALADO. El destello se dibuja de 24 px sobre el lienzo original,
  // pero el mp4 se reduce a 380 px de ancho, así que en el vídeo mide unos 7 px y vive pegado
  // a la esquina. Mirar un cuadro fijo de 24x24 en (4,4) lo dejaba fuera casi entero — por eso
  // la primera versión no encontraba ningún destello.
  const LADO = 22;
  ff(['-i', mp4, '-vf', `crop=${LADO}:${LADO}:0:0`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', raw]);
  const b = readFileSync(raw);
  const porFrame = LADO * LADO * 3;
  const n = Math.floor(b.length / porFrame);
  let mejor = -1;
  let mx = -1;
  // Los primeros fotogramas se saltan: la grabación empieza con la pantalla en blanco antes de
  // que pinte nada, y ese blanco ganaba siempre. El destello nunca cae ahí — el del clic va a
  // los 9 s y el del reveal a los ~3.7 s.
  for (let f = saltar; f < n; f++) {
    // Se busca BLANCO, no brillo: el criterio es el mínimo de los tres canales del píxel más
    // blanco del recorte. Con el máximo a secas ganaba el preloader —que llena la esquina de
    // verde acento, y el verde también satura un canal— y todos los clips "arrancaban" en el
    // fotograma 0. El destello es #fff, así que su mínimo es 255; el del acento, 57.
    let m = 0;
    for (let i = 0; i < porFrame; i += 3) {
      const r = b[f * porFrame + i] ?? 0;
      const g = b[f * porFrame + i + 1] ?? 0;
      const bl = b[f * porFrame + i + 2] ?? 0;
      m = Math.max(m, Math.min(r, g, bl));
    }
    if (m > mx) {
      mx = m;
      mejor = f;
    }
  }
  return mx > 150 ? mejor : -1;
}

export function frameDeEfecto(mp4: string, cual: 'color' | 'tinta', tmpDir: string): number {
  mkdirSync(tmpDir, { recursive: true });
  const raw = join(tmpDir, 'align.rgb');
  rmSync(raw, { force: true });
  const W = 48;
  const H = 30;
  ff(['-i', mp4, '-vf', `scale=${W}:${H}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', raw]);
  const b = readFileSync(raw);
  const porFrame = W * H * 3;
  const n = Math.floor(b.length / porFrame);
  const serie: number[] = [];
  for (let f = 0; f < n; f++) {
    let c = 0;
    for (let i = 0; i < W * H; i++) {
      const o = f * porFrame + i * 3;
      const R = b[o] ?? 0;
      const G = b[o + 1] ?? 0;
      const B = b[o + 2] ?? 0;
      if (cual === 'color') {
        if (R > G + 12 && R > 40) c++;
      } else if (0.2126 * R + 0.7152 * G + 0.0722 * B > 28) c++;
    }
    serie.push(c / (W * H));
  }
  if (serie.length === 0) return 0;
  // Línea base: la MEDIANA de los primeros fotogramas, no la media — un fotograma suelto de
  // codificación sucia arrastraba la media y disparaba el umbral en el fotograma 0.
  const cabeza = serie.slice(0, Math.max(3, Math.floor(serie.length * 0.12))).sort((x, y) => x - y);
  const b0 = cabeza[Math.floor(cabeza.length / 2)] ?? 0;
  const pico = Math.max(...serie);
  const umbral = b0 + Math.max(0.015, (pico - b0) * 0.1);
  // Y se exige que el subidón SE MANTENGA tres fotogramas: el arranque de una onda no se
  // desdice, un parpadeo del codificador sí.
  for (let i = 0; i < serie.length - 2; i++) {
    if ((serie[i] ?? 0) > umbral && (serie[i + 1] ?? 0) > umbral && (serie[i + 2] ?? 0) > umbral) {
      return i;
    }
  }
  return 0;
}

/**
 * Pega varios mp4 uno al lado del otro, cada uno con su rótulo arriba. Comparar dos archivos que
 * se reproducen por separado no es comparar: el ojo no retiene el ritmo de uno mientras mira el
 * otro, y aquí lo que se juzga es justo el ritmo.
 *
 * Si el `drawtext` de este ffmpeg no encuentra fuente, se apaña sin rótulos en vez de fallar:
 * mejor un vídeo sin etiquetas que ningún vídeo.
 */
export function mosaico(entradas: Array<{ mp4: string; rotulo: string }>, destino: string): void {
  const FUENTE = 'C\\:/Windows/Fonts/consola.ttf';
  const filtros = entradas
    .map(
      (e, i) =>
        `[${i}:v]pad=iw:ih+34:0:34:black,drawtext=fontfile='${FUENTE}':text='${e.rotulo.replace(/'/g, '')}':x=10:y=8:fontsize=20:fontcolor=white[v${i}]`,
    )
    .join(';');
  const cadena = entradas.map((_, i) => `[v${i}]`).join('');
  const entradasArgs = entradas.flatMap((e) => ['-i', e.mp4]);
  try {
    ff([
      ...entradasArgs,
      '-filter_complex',
      `${filtros};${cadena}hstack=inputs=${entradas.length}[out]`,
      '-map',
      '[out]',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      destino,
    ]);
  } catch {
    ff([
      ...entradasArgs,
      '-filter_complex',
      `hstack=inputs=${entradas.length}[out]`,
      '-map',
      '[out]',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      destino,
    ]);
  }
}
