// scripts/check-bleed.ts — comprueba la sangría de color del retrato: ¿revela color de verdad,
// se propaga desde el cursor, y respeta los bordes del sujeto en vez de dibujar un disco?
// Mide con la misma lógica que scripts/recon-ascii-hover.ts aplicó a la referencia, para que
// las cifras se puedan comparar. Necesita `?debug` para llegar a la instancia del retrato.

import { chromium } from 'playwright';
import { startPreview } from './lib/preview.ts';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4198;
const URL = `http://localhost:${PORT}/?debug`;
const OUT = resolve('screenshots', 'bleed');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const results: string[] = [];
const failures: string[] = [];
const consoleErrors: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  const line = `${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`;
  results.push(line);
  if (!ok) failures.push(line);
  console.log(line);
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* aún no */
    }
    await sleep(400);
  }
  throw new Error(`El preview no respondió en ${URL}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const preview = startPreview(PORT);
  await waitForServer();

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 15_000 });
  await page.waitForFunction(
    () => Number(document.querySelector('[data-ascii]')?.getAttribute('data-reveal') ?? 0) >= 1,
    null,
    { timeout: 20_000 },
  );
  await sleep(700);

  const box = await page.evaluate(() => {
    const c = document.querySelector('[data-ascii]');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  });
  if (!box) throw new Error('sin canvas');
  console.log(`canvas: ${box.x},${box.y} ${box.width}x${box.height}`);

  const grab = async (): Promise<string> => {
    const buf = await page.screenshot({ clip: box });
    return 'data:image/png;base64,' + buf.toString('base64');
  };

  // El puntero se lleva al cuerpo del jaguar, donde hay tinta y bordes reales.
  const px = box.x + Math.round(box.width * 0.4);
  const py = box.y + Math.round(box.height * 0.45);

  await page.mouse.move(40, 780);
  await sleep(1400);
  const sin = await grab();
  await page.mouse.move(px, py, { steps: 18 });
  await sleep(1500);
  const con = await grab();
  await page.screenshot({ path: join(OUT, 'bleed-hover.png'), clip: box });

  const lab = await ctx.newPage();
  await lab.setContent('<div></div>');
  const stats = (await lab.evaluate(
    async ([a, c, cx, cy]) => {
      const load = (src: string): Promise<HTMLImageElement> =>
        new Promise((res) => {
          const i = new Image();
          i.onload = () => res(i);
          i.src = src;
        });
      const data = async (src: string): Promise<ImageData> => {
        const img = await load(src);
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const g = cv.getContext('2d');
        if (!g) throw new Error('sin contexto');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, cv.width, cv.height);
      };
      const A = await data(a as string);
      const C = await data(c as string);
      const W = A.width;
      const H = A.height;
      const ox = cx as number;
      const oy = cy as number;

      /**
       * Distancia del TONO de un píxel al del acento, normalizada. Es la métrica correcta
       * para "aquí ya no es monocromo": la saturación no vale, porque el acento es un verde
       * puro (0.78) y los colores reales de una foto suelen ser MENOS saturados, así que
       * revelar el color de verdad puede bajarla — medido, −6.5 % en el anillo central.
       * Devuelve −1 si el píxel no tiene tinta suficiente para opinar.
       */
      const sat = (D: ImageData, i: number): number => {
        const r = D.data[i] ?? 0;
        const g = D.data[i + 1] ?? 0;
        const b = D.data[i + 2] ?? 0;
        const mx = Math.max(r, g, b);
        if (mx < 26) return -1;
        // Normalizado por el brillo, para no confundir "más color" con "más luz".
        const nr = r / mx;
        const ng = g / mx;
        const nb = b / mx;
        // Acento --accent #39FF6A normalizado: 0.224, 1, 0.416
        return Math.hypot(nr - 0.224, ng - 1, nb - 0.416) / 1.6;
      };

      const R = 200;
      const nb = 10;
      const dSat = new Array<number>(nb).fill(0);
      const cnt = new Array<number>(nb).fill(0);
      let conTinta = 0;
      let cambian = 0;
      let discoTotal = 0;

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = Math.hypot(x - ox, y - oy);
          if (d > R) continue;
          const i = (y * W + x) * 4;
          if (d <= 90) discoTotal++;
          const sa = sat(A, i);
          const sc = sat(C, i);
          if (sa < 0 && sc < 0) continue;
          const b = Math.min(nb - 1, Math.floor((d / R) * nb));
          dSat[b] = (dSat[b] ?? 0) + (Math.max(0, sc) - Math.max(0, sa));
          cnt[b] = (cnt[b] ?? 0) + 1;
          if (d <= 90) {
            conTinta++;
            const dif =
              Math.abs((A.data[i] ?? 0) - (C.data[i] ?? 0)) +
              Math.abs((A.data[i + 1] ?? 0) - (C.data[i + 1] ?? 0)) +
              Math.abs((A.data[i + 2] ?? 0) - (C.data[i + 2] ?? 0));
            if (dif > 30) cambian++;
          }
        }
      }

      return {
        perfilSaturacion: dSat.map((v, i) => Number((v / Math.max(1, cnt[i] ?? 1)).toFixed(4))),
        pxTintaEnDisco: conTinta,
        pxDelDisco: discoTotal,
        cambianEnDisco: cambian,
        fraccionDelDiscoQueCambia: Number((cambian / Math.max(1, discoTotal)).toFixed(3)),
      };
    },
    [sin, con, px - box.x, py - box.y],
  )) as {
    perfilSaturacion: number[];
    pxTintaEnDisco: number;
    pxDelDisco: number;
    cambianEnDisco: number;
    fraccionDelDiscoQueCambia: number;
  };
  await lab.close();

  console.log(
    `      distancia al acento ganada por anillos de 20 px: ${JSON.stringify(stats.perfilSaturacion)}`,
  );
  const p = stats.perfilSaturacion;
  const centro = p[0] ?? 0;
  const borde = p[9] ?? 0;

  check(
    'el hover REVELA color: el tono se aleja del acento junto al cursor',
    centro > 0.03,
    `+${(centro * 100).toFixed(1)} % en el anillo central (la referencia no revela color en absoluto)`,
  );
  check(
    'y decae con la distancia en vez de teñir el retrato entero',
    centro > Math.abs(borde) * 3,
    `centro +${(centro * 100).toFixed(1)} % · borde ${(borde * 100).toFixed(1)} %`,
  );
  check(
    'no es un disco lleno: se tiñe solo una parte del área',
    stats.fraccionDelDiscoQueCambia < 0.6,
    `cambia el ${(stats.fraccionDelDiscoQueCambia * 100).toFixed(0)} % del disco de 90 px`,
  );

  // --- LO ESENCIAL: ¿respeta los bordes? Se lee el estado interno y, en cada dirección desde
  // el cursor, se mide hasta dónde llega el color y qué contraste máximo hubo por el camino.
  // Si la sangría fuera un disco, el alcance sería igual en todas; si respeta bordes, las
  // direcciones que cruzan un borde fuerte se quedan cortas.
  await page.mouse.move(px, py, { steps: 10 });
  await sleep(1600);
  const rayos = (await page.evaluate(() => {
    const w = window as unknown as {
      __asciiPortrait?: {
        bleed: Float32Array;
        luma: Float32Array;
        cols: number;
        rows: number;
        pointerX: number;
        pointerY: number;
      };
    };
    const a = w.__asciiPortrait;
    if (!a) return null;
    const cx = Math.round(a.pointerX);
    const cy = Math.round(a.pointerY);
    const dirs: Array<[number, number, string]> = [
      [1, 0, 'derecha'],
      [-1, 0, 'izquierda'],
      [0, 1, 'abajo'],
      [0, -1, 'arriba'],
      [1, 1, 'diagonal ↘'],
      [-1, -1, 'diagonal ↖'],
    ];
    return dirs.map(([dx, dy, nombre]) => {
      let alcance = 0;
      let maxSalto = 0;
      let prev = a.luma[cy * a.cols + cx] ?? 0;
      for (let k = 1; k < 30; k++) {
        const x = cx + dx * k;
        const y = cy + dy * k;
        if (x < 0 || y < 0 || x >= a.cols || y >= a.rows) break;
        const i = y * a.cols + x;
        const l = a.luma[i] ?? 0;
        maxSalto = Math.max(maxSalto, Math.abs(l - prev));
        prev = l;
        if ((a.bleed[i] ?? 0) > 0.12) alcance = k;
      }
      return { nombre, alcance, contrasteMax: Number(maxSalto.toFixed(3)) };
    });
  })) as Array<{ nombre: string; alcance: number; contrasteMax: number }> | null;

  if (!rayos) {
    check('se puede leer el estado interno de la sangría', false, 'sin instancia (¿falta ?debug?)');
  } else {
    console.log('      alcance del color por dirección (celdas) y contraste encontrado:');
    for (const r of rayos)
      console.log(
        `        ${r.nombre.padEnd(12)} alcance ${String(r.alcance).padStart(2)} celdas · contraste máx ${r.contrasteMax}`,
      );
    const alcances = rayos.map((r) => r.alcance);
    const variacion = Math.max(...alcances) - Math.min(...alcances);
    check(
      'el alcance NO es igual en todas las direcciones: no es un disco',
      variacion >= 3,
      `de ${Math.min(...alcances)} a ${Math.max(...alcances)} celdas`,
    );
    // Correlación: a más contraste por el camino, menos alcance.
    const conBorde = rayos.filter((r) => r.contrasteMax > 0.25);
    const sinBorde = rayos.filter((r) => r.contrasteMax <= 0.25);
    if (conBorde.length > 0 && sinBorde.length > 0) {
      const mediaCon = conBorde.reduce((a2, r) => a2 + r.alcance, 0) / conBorde.length;
      const mediaSin = sinBorde.reduce((a2, r) => a2 + r.alcance, 0) / sinBorde.length;
      check(
        'las direcciones que cruzan un borde llegan menos lejos',
        mediaCon < mediaSin,
        `con borde ${mediaCon.toFixed(1)} celdas · sin borde ${mediaSin.toFixed(1)}`,
      );
    } else {
      console.log(
        `      (no hay bordes fuertes y suaves a la vez en este punto: ${conBorde.length} con / ${sinBorde.length} sin)`,
      );
    }
  }

  // Coste por frame: el presupuesto de §8 son 4 ms
  const ms = await page.evaluate(async () => {
    const w = window as unknown as { __asciiPortrait?: { frameMs: number } };
    const s: number[] = [];
    for (let i = 0; i < 40; i++) {
      s.push(w.__asciiPortrait?.frameMs ?? 0);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    s.sort((a, b) => a - b);
    return { mediana: s[s.length >> 1] ?? 0, max: s[s.length - 1] ?? 0 };
  });
  console.log(
    `      coste de pintado con la sangría activa: mediana ${ms.mediana.toFixed(2)} ms · máx ${ms.max.toFixed(2)} ms`,
  );
  check('sigue dentro del presupuesto de 4 ms/frame (§8)', ms.max < 4, `máximo ${ms.max.toFixed(2)} ms`);

  await page.mouse.move(40, 780);
  await sleep(1800);
  const recogido = await page.evaluate(() => {
    const w = window as unknown as { __asciiPortrait?: { bleedActive?: boolean } };
    return w.__asciiPortrait?.bleedActive ?? null;
  });
  check('al salir el puntero la sangría se repliega', recogido === false, `bleedActive=${recogido}`);
  await page.screenshot({ path: join(OUT, 'bleed-rest.png'), clip: box });

  console.log(`\n${results.length - failures.length}/${results.length} comprobaciones OK`);
  console.log(
    consoleErrors.length === 0 ? 'Sin errores de consola.' : `ERRORES:\n${consoleErrors.join('\n')}`,
  );
  if (failures.length > 0 || consoleErrors.length > 0) process.exitCode = 1;

  await browser.close();
  preview.stop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
