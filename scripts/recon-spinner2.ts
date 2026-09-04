// scripts/recon-spinner2.ts — segunda pasada sobre el preloader de la referencia, con la red
// estrangulada para que la carga dure mucho más. Responde lo que la primera pasada no pudo:
// ¿los cuatro cuadrados vuelcan una sola vez (indicador de progreso) o el ciclo se repite (loop)?

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');
const CAPTURE_MS = Number(process.argv[3] ?? 25_000);
/** kbps de bajada. 180 = la carga es tan lenta que ni el JS llega; 1600 ≈ "fast 3G". */
const KBPS = Number(process.argv[2] ?? 180);

interface Sample {
  t: number;
  deg: number[];
  tx: number[];
  label: string;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Estrangular la red desde CDP: así el preloader vive mucho más y se ve si el ciclo repite.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (KBPS * 1024) / 8,
    uploadThroughput: (KBPS * 1024) / 16,
  });
  console.log(`red a ${KBPS} kbps · capturando ${CAPTURE_MS} ms`);

  await page.addInitScript((captureMs: number) => {
    const w = window as unknown as {
      __p: { s: Sample[]; goneAt: number; t0: number };
    };
    interface Sample {
      t: number;
      deg: number[];
      tx: number[];
      label: string;
    }
    w.__p = { s: [], goneAt: -1, t0: performance.now() };

    /** La pista del indicador: 70×16 px con los cuatro cuadrados dentro. */
    const findTrack = (): HTMLElement | null => {
      for (const el of document.querySelectorAll<HTMLElement>('body div')) {
        const st = el.getAttribute('style') ?? '';
        if (st.includes('width:70px') && st.includes('height:16px')) return el;
      }
      return null;
    };

    const tick = (): void => {
      const t = performance.now() - w.__p.t0;
      const track = findTrack();

      if (track) {
        const blocks = [...track.children] as HTMLElement[];
        const deg: number[] = [];
        const tx: number[] = [];
        for (const b of blocks) {
          const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(b).transform);
          if (!m) {
            deg.push(0);
            tx.push(0);
            continue;
          }
          const v = m[1].split(',').map(Number);
          deg.push((Math.atan2(v[1] ?? 0, v[0] ?? 1) * 180) / Math.PI);
          tx.push(v[4] ?? 0);
        }
        const labelEl = track.parentElement?.querySelector('span[aria-hidden][style*="absolute"]');
        w.__p.s.push({ t, deg, tx, label: labelEl?.textContent ?? '' });
      } else if (w.__p.s.length > 0 && w.__p.goneAt < 0) {
        w.__p.goneAt = t;
      }

      if (t < captureMs) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, CAPTURE_MS);

  // Screencast por CDP: frames reales del compositor, sin el coste de page.screenshot()
  // que en capturas anteriores falseó las marcas de tiempo.
  const shotDir = join(OUT, 'spinner-frames');
  rmSync(shotDir, { recursive: true, force: true });
  mkdirSync(shotDir, { recursive: true });
  let nShots = 0;
  const castStart = Date.now();
  cdp.on('Page.screencastFrame', (ev) => {
    const ms = Date.now() - castStart;
    if (nShots < 240) {
      writeFileSync(join(shotDir, `${String(ms).padStart(6, '0')}.jpg`), Buffer.from(ev.data, 'base64'));
      nShots++;
    }
    void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.enable');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });

  await page.goto(URL, { waitUntil: 'commit', timeout: 120_000 });
  await page.waitForTimeout(CAPTURE_MS + 500);
  await cdp.send('Page.stopScreencast').catch(() => {});
  console.log(`screencast: ${nShots} frames en ${shotDir}`);

  const data = (await page.evaluate(() => {
    const w = window as unknown as { __p: unknown };
    return w.__p;
  })) as { s: Sample[]; goneAt: number };

  writeFileSync(join(OUT, 'spinner-slow.json'), JSON.stringify(data, null, 1), 'utf8');

  const { s } = data;
  console.log(
    `preloader visible ${s.length} frames · desaparece a los ${data.goneAt < 0 ? 'nunca (>' + CAPTURE_MS + ')' : Math.round(data.goneAt) + ' ms'}`,
  );
  if (s.length === 0) {
    console.log('no se encontró la pista de 70×16');
    await browser.close();
    return;
  }
  console.log(`bloques en la pista: ${s[0]?.deg.length ?? 0}`);

  const n = s[0]?.deg.length ?? 0;
  for (let i = 0; i < n; i++) {
    // Desenrollar el ángulo para contar vueltas acumuladas aunque reinicie.
    let acc = 0;
    let prev = s[0]?.deg[i] ?? 0;
    const tumbles: number[] = [];
    let lastQuarter = 0;
    for (const f of s) {
      const cur = f.deg[i] ?? 0;
      let dd = cur - prev;
      if (dd > 180) dd -= 360;
      if (dd < -180) dd += 360;
      acc += dd;
      prev = cur;
      const q = Math.round(Math.abs(acc) / 90);
      if (q > lastQuarter) {
        tumbles.push(Math.round(f.t));
        lastQuarter = q;
      }
    }
    const txs = [...new Set(s.map((f) => Math.round(f.tx[i] ?? 0)))];
    console.log(
      `\nbloque ${i}: ${tumbles.length} vuelco(s) de 90° · acumulado ${acc.toFixed(0)}°` +
        `\n  completa cada vuelco a los: ${tumbles.join(', ')} ms` +
        `\n  posiciones translateX: ${txs.join(', ')}`,
    );
  }

  const labels = [...new Set(s.map((f) => f.label))];
  console.log(`\netiqueta: ${labels.length} estados distintos`);
  console.log(
    '  ' +
      labels
        .slice(0, 20)
        .map((l) => JSON.stringify(l))
        .join(' → '),
  );

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
