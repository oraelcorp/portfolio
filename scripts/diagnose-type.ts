// scripts/diagnose-type.ts — diagnóstico tipográfico del retrato ASCII.
// Responde con métricas, no con impresiones:
//   H1) ¿el glifo excede la celda de 7.56 px? → caja real del glifo vs celda
//   H2) ¿las celdas caen en píxeles fraccionarios? → posiciones x/y en píxeles de dispositivo
//   H3) ¿sirve Silkscreen? → cobertura de la rampa y si es realmente monoespaciada

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4182;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Todos los glifos que puede producir charRamp.ts. */
const RAMP = `.'\`:,;-~+17cr23ae56bd89AE04BCDF68#%@`;

async function main(): Promise<void> {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(URL)).ok) break;
      } catch {
        /* aún no */
      }
      await sleep(400);
    }

    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(URL, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await sleep(500);

    const report = await page.evaluate(
      async ({ ramp, cell }) => {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        if (!ctx) return null;

        // Se fuerza la carga de ambas familias antes de medir
        await Promise.all([
          document.fonts.load(`${cell}px "JetBrains Mono"`, ramp),
          document.fonts.load(`${cell}px Silkscreen`, ramp),
        ]);

        const measureFamily = (family: string, size: number) => {
          ctx.font = `${size}px ${family}`;
          const m = ctx.measureText('0');

          let minTop = Infinity;
          let maxBottom = -Infinity;
          let minAdv = Infinity;
          let maxAdv = -Infinity;
          const advances: Record<string, number> = {};

          for (const ch of ramp) {
            const mm = ctx.measureText(ch);
            advances[ch] = Math.round(mm.width * 1000) / 1000;
            minAdv = Math.min(minAdv, mm.width);
            maxAdv = Math.max(maxAdv, mm.width);
            // Caja real de tinta, relativa a la línea base
            if (mm.actualBoundingBoxAscent > -Infinity) {
              minTop = Math.min(minTop, -mm.actualBoundingBoxAscent);
              maxBottom = Math.max(maxBottom, mm.actualBoundingBoxDescent);
            }
          }

          return {
            family,
            size,
            advance: Math.round(m.width * 1000) / 1000,
            // Caja de la FUENTE (lo que ocupa una línea completa)
            fontBox: Math.round((m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) * 1000) / 1000,
            fontAscent: Math.round(m.fontBoundingBoxAscent * 1000) / 1000,
            fontDescent: Math.round(m.fontBoundingBoxDescent * 1000) / 1000,
            // Caja real de TINTA de toda la rampa
            inkBox: Math.round((maxBottom - minTop) * 1000) / 1000,
            monospaced: Math.abs(maxAdv - minAdv) < 0.01,
            advanceSpread: Math.round((maxAdv - minAdv) * 1000) / 1000,
            advances,
          };
        };

        // ¿Silkscreen tiene realmente los glifos, o el navegador cae a otra fuente?
        const coverage = (): { missing: string[]; checked: number } => {
          const missing: string[] = [];
          for (const ch of ramp) {
            ctx.font = `40px Silkscreen`;
            const withFont = ctx.measureText(ch).width;
            ctx.font = `40px "___nope___"`;
            const fallback = ctx.measureText(ch).width;
            // Si coincide exactamente con el fallback, es señal de que no hay glifo propio
            if (Math.abs(withFont - fallback) < 0.01) missing.push(ch);
          }
          return { missing, checked: ramp.length };
        };

        const canvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
        const dpr = canvas ? canvas.width / canvas.getBoundingClientRect().width : 1;

        return {
          dpr,
          jb: measureFamily('"JetBrains Mono"', cell),
          jbHalf: measureFamily('"JetBrains Mono"', cell * 0.75),
          silk: measureFamily('Silkscreen', cell),
          silkCoverage: coverage(),
          // Posiciones de las primeras celdas en píxeles de dispositivo
          positions: [0, 1, 2, 3, 4, 5].map((i) => Math.round(i * cell * dpr * 1000) / 1000),
        };
      },
      { ramp: RAMP, cell: 7.56 },
    );

    if (!report) throw new Error('No se pudo medir');

    console.log('=== H1 · ¿El glifo excede la celda de 7.56 px? ===\n');
    for (const f of [report.jb, report.jbHalf]) {
      const over = f.fontBox - 7.56;
      console.log(`  ${f.family} a ${f.size}px`);
      console.log(
        `    avance            ${f.advance} px   (celda 7.56 → estirado ×${(7.56 / f.advance).toFixed(2)})`,
      );
      console.log(
        `    caja de fuente    ${f.fontBox} px   (asc ${f.fontAscent} + desc ${f.fontDescent})  → ${over > 0 ? `EXCEDE la celda en ${over.toFixed(2)} px` : 'cabe'}`,
      );
      console.log(`    caja de tinta     ${f.inkBox} px   (toda la rampa)\n`);
    }

    console.log('=== H2 · ¿Las celdas caen en píxeles enteros? ===\n');
    console.log(`  DPR del canvas: ${report.dpr}`);
    console.log(`  posición de las celdas 0–5 en px de dispositivo: ${report.positions.join(', ')}`);
    const fractional = report.positions.filter((p) => Math.abs(p - Math.round(p)) > 0.001).length;
    console.log(
      `  → ${fractional} de 6 caen en píxel fraccionario ${fractional > 0 ? '(fuente de borrosidad)' : '(alineado)'}\n`,
    );

    console.log('=== H3 · ¿Sirve Silkscreen para la rampa? ===\n');
    const s = report.silk;
    console.log(
      `  monoespaciada:    ${s.monospaced ? 'SÍ' : `NO — los avances varían ${s.advanceSpread} px`}`,
    );
    console.log(
      `  glifos ausentes:  ${report.silkCoverage.missing.length} de ${report.silkCoverage.checked}${report.silkCoverage.missing.length ? ` → ${report.silkCoverage.missing.join(' ')}` : ''}`,
    );
    console.log(`  avance de '0':    ${s.advance} px · caja de fuente ${s.fontBox} px`);

    await browser.close();
  } finally {
    server.kill();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
