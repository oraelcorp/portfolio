// scripts/alinear-onda.ts — recorta cada clip por donde EMPIEZA su efecto y monta la comparativa.
//
// Se separa de `record-onda.ts` a propósito: grabar cuesta minutos y alinear son segundos, así
// que el montaje se puede repetir sin volver a pasar por el navegador.
//
// El porqué del alineado está en `frameDeEfecto`: marcar el instante con `Date.now()` daba
// cuatro paneles en momentos distintos de la onda, y cuatro clips desfasados no comparan nada.
import { frameDeMarca, mosaico } from './lib/video.ts';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve('screenshots', 'onda');
const TMP = join(OUT, 'tmp-rec');
const FPS = 25;

const VARIANTES: Array<[string, string]> = [
  ['hoy', 'HOY  circulo perfecto'],
  ['ruido', 'RUIDO 6  borde roto'],
  ['ruido-tono', 'RUIDO 6 + TONO 5'],
  ['ruido-tono-cubic', 'RUIDO 6 + TONO 5 + cubic.out'],
];

/** Segundos de margen antes del arranque, para que se vea el estado de partida. */
const ANTES = 0.32;
const DUR: Record<string, number> = { clic: 1.9, reveal: 3.6 };

for (const efecto of ['clic', 'reveal'] as const) {
  const clips: Array<{ mp4: string; rotulo: string }> = [];
  for (const [id, rotulo] of VARIANTES) {
    const src = join(TMP, `${efecto}-${id}.mp4`);
    if (!existsSync(src)) {
      console.error(`falta ${src} — hay que correr record-onda.ts antes`);
      process.exit(1);
    }
    // El ancla es el DESTELLO que la página enciende al arrancar el efecto (ver `record-onda`).
    const f = frameDeMarca(src, TMP);
    if (f < 0) {
      console.error(`   ${efecto} · ${id}: no se encontró el destello — clip descartado`);
      continue;
    }
    const desde = Math.max(0, f / FPS - ANTES);
    const dst = join(TMP, `al-${efecto}-${id}.mp4`);
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        String(desde),
        '-i',
        src,
        '-t',
        String(DUR[efecto]),
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        dst,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    console.log(`   ${efecto} · ${id}: destello en el fotograma ${f} (${(f / FPS).toFixed(2)}s)`);
    clips.push({ mp4: dst, rotulo });
  }
  const destino = join(OUT, efecto === 'clic' ? 'onda-clic-comparativa.mp4' : 'reveal-comparativa.mp4');
  mosaico(clips, destino);
  console.log(`   -> ${destino}`);
}
