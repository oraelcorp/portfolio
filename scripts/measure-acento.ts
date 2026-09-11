// scripts/measure-acento.ts — ¿cuánto aguanta el retrato si cambia el color de acento?
//
// El retrato pinta su base con el acento sobre casi-negro, así que un cambio de marca le afecta
// más que a ningún otro componente: lo que en un botón es un matiz de color, aquí es un dibujo
// que se apaga o no. El verde actual tiene luminancia 0.734 y va sobrado; un acento oscuro no.
//
// Se mide lo que se ve: luminancia media de la tinta pintada y contraste contra el fondo real
// del hero. El acento vigente encabeza la tabla como referencia. Se escribió al auditar un
// cambio de marca a guinda —descartado— y se queda porque la pregunta vuelve con cada color:
// antes de mover el acento, esto dice lo que le cuesta al retrato.
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4270;
const OUT = resolve('screenshots', 'acento');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Candidatos a barrer. El primero es el acento vigente, que sirve de referencia; los demás
 * cubren el rango de luminancia que suele tener un color de marca, de oscuro a claro.
 */
const CANDIDATOS: Array<[string, string]> = [
  ['#39ff6a (acento actual)', '#39ff6a'],
  ['#a61e4d (oscuro)', '#a61e4d'],
  ['#c41e4d', '#c41e4d'],
  ['#ee5f86 (medio)', '#ee5f86'],
  ['#ff8fa6 (claro)', '#ff8fa6'],
];

const TOPE_MS = 7 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

const preview = startPreview(PORT);
const L: string[] = [];
const say = (s = ''): void => {
  console.log(s);
  L.push(s);
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {
      /* aún no */
    }
    await sleep(400);
  }
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelector<HTMLCanvasElement>('[data-ascii]')?.dataset.glReveal === '1.000',
    null,
    { timeout: 40_000 },
  );
  // Modo ASCII FORZADO. La primera corrida midió con el retrato en color —basta un clic ajeno
  // sobre la ventana, que estas sondas abren en primer plano— y las cinco filas salieron
  // idénticas: en color el acento no pinta nada, así que no se estaba midiendo lo que se creía.
  await page.evaluate(`(() => {
    const g = window.__asciiGL;
    g.frozen = true; g.source.pause(); g.source.currentTime = 4.0;
    g.modo = 'ascii'; g.colorBase = 0; g.colorTarget = 0; g.colorR = 0;
    document.querySelector('[data-ascii]').dataset.glMode = 'ascii';
  })()`);
  await sleep(900);

  say('== EL RETRATO CON EL ACENTO NUEVO · modo ASCII sobre el fondo del hero ==');
  say('   tinta = píxeles pintados · luz media = luminancia media de esa tinta (0-255)');
  say('   contraste = de la tinta pintada contra el fondo real del hero');
  say('');
  say('   candidato                      tinta    luz media   contraste');

  for (const [nombre, hex] of CANDIDATOS) {
    await page.evaluate(
      ({ h }) => {
        document.documentElement.style.setProperty('--accent', h);
        const w = window as unknown as { __asciiGL?: { refrescarTokens?: () => void } };
        w.__asciiGL?.refrescarTokens?.();
      },
      { h: hex },
    );
    // Se vuelve a forzar ASCII en cada vuelta, por si algo lo movió entre medias.
    await page.evaluate(`(() => {
      const g = window.__asciiGL;
      g.modo = 'ascii'; g.colorBase = 0; g.colorTarget = 0; g.colorR = 0;
    })()`);
    await sleep(700);

    const r = (await page.evaluate(`(() => {
      const c = document.querySelector('[data-ascii]');
      const off = document.createElement('canvas');
      off.width = c.width; off.height = c.height;
      const x = off.getContext('2d', { willReadFrequently: true });
      x.drawImage(c, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let tinta = 0, suma = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i+1] + 0.0722 * d[i+2];
        if (l < 12) continue;
        tinta++; suma += l;
      }
      // Fondo real del hero, para el contraste.
      const bg = getComputedStyle(document.body).backgroundColor.match(/\\d+/g) || ['20','19','20'];
      const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      const Lbg = 0.2126 * lin(+bg[0]) + 0.7152 * lin(+bg[1]) + 0.0722 * lin(+bg[2]);
      const media = tinta ? suma / tinta : 0;
      const Ltinta = lin(media);
      const contraste = (Math.max(Ltinta, Lbg) + 0.05) / (Math.min(Ltinta, Lbg) + 0.05);
      return { tinta, media, contraste };
    })()`)) as { tinta: number; media: number; contraste: number };

    say(
      `   ${nombre.padEnd(28)} ${String(r.tinta).padStart(8)}   ${r.media.toFixed(1).padStart(9)}   ${r.contraste.toFixed(2).padStart(9)}:1`,
    );
    await page.locator('[data-ascii]').screenshot({ path: join(OUT, `ascii-${hex.replace('#', '')}.png`) });
  }

  writeFileSync(join(OUT, 'acento.txt'), L.join('\n'), 'utf8');
  say('');
  say(`Capturas en ${OUT}`);
  await ctx.close();
  await browser.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  preview.stop();
  process.exit(process.exitCode ?? 0);
}
