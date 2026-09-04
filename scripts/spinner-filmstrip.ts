// scripts/spinner-filmstrip.ts — recorta la zona del indicador de carga en los frames del
// screencast de la referencia y los apila en una tira, para MIRAR el efecto en vez de solo medirlo.
// Salida en screenshots/spinner-strip.png (gitignored, comparación local — §10.6).

import { chromium } from 'playwright';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FRAMES = resolve('recon/spinner-frames');
const OUT = resolve('screenshots');

/** El indicador va centrado en un viewport de 1440×900. Recorte generoso alrededor. */
const CROP = { x: 660, y: 415, w: 120, h: 70 };

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const all = readdirSync(FRAMES)
    .filter((f) => f.endsWith('.jpg'))
    .sort();
  const from = Number(process.argv[2] ?? 3300);
  const to = Number(process.argv[3] ?? 6000);
  const win = all.filter((f) => {
    const t = Number(f.slice(0, 6));
    return t >= from && t <= to;
  });
  // Repartir hasta 24 frames uniformemente por la ventana.
  const step = Math.max(1, Math.ceil(win.length / 24));
  const picked = win.filter((_, i) => i % step === 0).slice(0, 24);
  console.log(`${all.length} frames · ${win.length} en [${from},${to}] ms · muestro ${picked.length}`);

  const cells = picked
    .map((f) => {
      const b64 = readFileSync(join(FRAMES, f)).toString('base64');
      return `<figure><div class="c"><img src="data:image/jpeg;base64,${b64}"></div><figcaption>${Number(f.slice(0, 6))} ms</figcaption></figure>`;
    })
    .join('');

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#111;font:11px ui-monospace,monospace;color:#bbb;
         display:grid;grid-template-columns:repeat(4,max-content);gap:10px;padding:12px}
    figure{margin:0}
    .c{width:${CROP.w * 3}px;height:${CROP.h * 3}px;overflow:hidden;position:relative;outline:1px solid #333}
    .c img{position:absolute;left:${-CROP.x * 3}px;top:${-CROP.y * 3}px;
           width:${1440 * 3}px;image-rendering:pixelated}
    figcaption{padding-top:3px;text-align:center}
  </style>${cells}`;

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1600, height: 400 } });
  await page.setContent(html);
  await page.waitForLoadState('networkidle');
  const el = await page.$('body');
  await el?.screenshot({ path: join(OUT, 'spinner-strip.png') });
  await browser.close();
  console.log('→ screenshots/spinner-strip.png');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
