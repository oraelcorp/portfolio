// scripts/prep-video.ts — prepara el vídeo del retrato para que el loop sea invisible. Fase 8.
//
// Por qué: el `jaguar.mp4` que pasó Javier cierra bien pero no perfecto. Medido sobre los 193
// frames únicos (RMS de luminancia a 64x36): la distancia último→primero es 5.01, frente a un
// máximo de 7.23 entre frames adyacentes y 37.26 del frame más lejano del primero. O sea: el
// salto del loop es del orden de un paso de movimiento real, no un corte brusco — pero se ve,
// porque ocurre siempre en el mismo instante y el ojo lo engancha por repetición.
//
// Mismo criterio que el fallback de la sangría: no confiar en que la fuente sea perfecta,
// blindar el resultado. En vez de pedir un vídeo mejor, se disuelve el punto de corte.
//
// El montaje, con D = duración original, X = crossfade y L = D - X la duración de salida:
//
//   out[t] = a(t)·src[t] + (1-a(t))·src[L+t]     para t en [0, X),  a: 0 -> 1
//   out[t] = src[t]                              para t en [X, L)
//
// Con eso out[0] = src[L], que enlaza por continuidad con out[L-ε] = src[L-ε]: el envoltorio
// del loop queda dentro de una disolvencia, no en un salto. Y en t = X las dos ramas valen
// src[X], así que tampoco se crea una costura nueva a la salida del crossfade.
//
// SEGUNDA PASADA — reencuadre. Medido sobre 8 frames, el material trae dos defectos que el
// recorte `cover` centrado no solo no arregla sino que empeora:
//
//   (a) El cuerpo está cortado por una recta horizontal en y=562, con negro debajo, así que
//       se lee como el animal rebanado. Dentro del recorte centrado ocupaba el 42-50 % del
//       ancho en TODOS los frames, y no había nada por debajo.
//   (b) El sujeto empieza en x=244 (puntas de los bigotes) pero el recorte centrado empieza
//       en x=381: se comía 137 px de la cara.
//
// El sujeto entero mide 1063x416 (aspecto 2.56) y el canvas es 0.72, así que NINGÚN recorte
// lo contiene: hay que elegir encuadre. Se elige el mismo que ya tenía aprobado la foto —
// cabeza a la izquierda, cuerpo saliendo por el borde derecho, negro arriba:
//
//   crop 580x558 desde (230,0)  → coge bigotes, hocico, fauces y hombro, y **corta justo por
//                                 encima de la recta**, de modo que el corte deja de flotar y
//                                 pasa a ser el borde inferior del frame: el cuerpo sale por
//                                 abajo, que es como salía en la versión de foto.
//   pad  580x806 con offset 248 → lleva el frame al aspecto 0.72 del canvas con negro arriba,
//                                 así `cover` en el shader es la identidad y no vuelve a
//                                 recortar la cara.
//
// El negro del padding va a 0x0f0f0f, NO a 0: el negro del vídeo mide 15/255, y rellenar con
// 0 crea una costura recta nueva justo lo que estamos quitando. (Ambos quedan por debajo del
// umbral de tinta de 0.12, así que en ASCII ninguno pinta — pero no depender de eso es gratis.)

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve('public/img/portrait/jaguar.mp4');
const OUT = resolve('public/img/portrait/jaguar-loop.mp4');

/** Duración del crossfade en segundos. 0.5 s ≈ 12 frames a los 24.07 fps reales del clip. */
const X = 0.5;

/** Reencuadre: recorte medido sobre la fuente + relleno hasta el aspecto del canvas. */
const CROP = { w: 580, h: 558, x: 230, y: 0 };
const PAD = { w: 580, h: 806, y: 248, color: '0x0f0f0f' };

function ffprobe(args: string[]): string {
  return execFileSync('ffprobe', args, { encoding: 'utf8' }).trim();
}

function main(): void {
  if (!existsSync(SRC)) throw new Error(`No encuentro el vídeo de origen: ${SRC}`);

  const D = Number(ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', SRC]));
  if (!Number.isFinite(D) || D <= 2 * X) throw new Error(`Duración inesperada: ${D}`);

  const L = D - X;
  console.log(`origen ${D.toFixed(3)} s · crossfade ${X} s · salida ${L.toFixed(3)} s`);

  // El reencuadre va ANTES del crossfade: así la disolvencia se mide sobre los píxeles que
  // de verdad se van a ver, no sobre zonas que el recorte iba a tirar.
  // `split` es obligatorio — a diferencia de `[0:v]`, una etiqueta de filtro no se puede
  // consumir tres veces (ffmpeg solo auto-duplica las de entrada).
  // `blend` recibe A = cabeza y B = cola. La rampa va con T, el tiempo dentro del segmento.
  const filter = [
    `[0:v]crop=${CROP.w}:${CROP.h}:${CROP.x}:${CROP.y},` +
      `pad=${PAD.w}:${PAD.h}:0:${PAD.y}:${PAD.color}[src]`,
    `[src]split=3[s1][s2][s3]`,
    `[s1]trim=0:${X},setpts=PTS-STARTPTS[head]`,
    `[s2]trim=${L}:${D},setpts=PTS-STARTPTS[tail]`,
    `[head][tail]blend=all_expr='A*(T/${X})+B*(1-T/${X})'[mixed]`,
    `[s3]trim=${X}:${L},setpts=PTS-STARTPTS[body]`,
    `[mixed][body]concat=n=2:v=1:a=0[out]`,
  ].join(';');

  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      SRC,
      '-filter_complex',
      filter,
      '-map',
      '[out]',
      // Sin audio: es un fondo decorativo y el track pesaba sin aportar nada.
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      // `faststart` mete el moov al principio: el vídeo empieza a decodificar sin
      // esperar a la descarga completa, que importa porque esto va en el hero.
      '-movflags',
      '+faststart',
      OUT,
      '-y',
    ],
    { stdio: 'inherit' },
  );

  const a = statSync(SRC).size / 1048576;
  const b = statSync(OUT).size / 1048576;
  console.log(`${a.toFixed(1)} MB -> ${b.toFixed(1)} MB`);
  console.log(OUT);
}

main();
