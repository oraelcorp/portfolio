// scripts/recon-botones.ts — los botones de la referencia contra los nuestros.
//
// Javier: con el cuerpo de texto ya reducido, los botones quedaron proporcionalmente grandes.
// Antes de encogerlos hay que saber si de verdad estamos por encima de su escala, igual que se
// hizo con la jerarquía tipográfica — y sobre todo hay que saber **hasta dónde se puede bajar**:
// en Fase 5 se verificó que todos los controles cumplen la zona táctil mínima (24x24 de WCAG 2.2
// AA, con 44x44 como guía de plataforma), y eso manda sobre el parecido.
//
// Por eso la tabla lleva el ALTO TOTAL además del tamaño de fuente: un botón no se percibe por su
// tipografía sino por su caja, y es la caja la que tiene el suelo de accesibilidad.
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve('recon');
const REF = 'https://good-fella.com/';
const PUERTO = 4280;
const VIEWPORT = { width: 1440, height: 900 };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 8 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

const L: string[] = [];
const say = (s = ''): void => {
  console.log(s);
  L.push(s);
};

interface Boton {
  texto: string;
  px: number;
  alto: number;
  ancho: number;
  padV: string;
  padH: string;
  familia: string;
  fondo: string;
}

/**
 * Recoge todo lo que se comporta como botón: enlaces y botones visibles, con su caja real.
 * No se filtra por clase porque las clases de la referencia no significan nada para nosotros.
 */
async function botones(page: Page): Promise<Boton[]> {
  return (await page.evaluate(`(() => {
    const fuera = [];
    const vistos = new Set();
    for (const el of document.querySelectorAll('a, button')) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 16) continue;
      const cs = getComputedStyle(el);
      const texto = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 26);
      if (!texto) continue;
      const clave = texto + '|' + Math.round(r.height);
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      fuera.push({
        texto,
        px: Math.round(parseFloat(cs.fontSize) * 10) / 10,
        alto: Math.round(r.height * 10) / 10,
        ancho: Math.round(r.width),
        padV: cs.paddingTop + '/' + cs.paddingBottom,
        padH: cs.paddingLeft + '/' + cs.paddingRight,
        familia: cs.fontFamily.split(',')[0].replace(/["']/g, '').slice(0, 14),
        fondo: cs.backgroundColor,
      });
    }
    return fuera;
  })()`)) as Boton[];
}

function tabla(titulo: string, bs: Boton[], filtro?: (b: Boton) => boolean): void {
  say(`   ${titulo}`);
  say('   texto                        px    alto   ancho   padding V      padding H      familia');
  for (const b of bs.filter((x) => (filtro ? filtro(x) : true))) {
    say(
      `   ${b.texto.padEnd(26)} ${b.px.toFixed(1).padStart(5)} ${b.alto.toFixed(1).padStart(7)} ${String(b.ancho).padStart(7)}   ${b.padV.padEnd(13)}  ${b.padH.padEnd(13)}  ${b.familia}`,
    );
  }
}

try {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium
    .launch({ channel: 'chrome', headless: false })
    .catch(() => chromium.launch({ headless: false }));

  say('== BOTONES · referencia contra nosotros, a 1440 px ==');
  say('   alto = caja real en pantalla. El suelo de accesibilidad va sobre la CAJA, no sobre la');
  say('   tipografía: 24x24 es el mínimo de WCAG 2.2 AA y 44x44 la guía de plataforma.');
  say('');

  {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(REF, { waitUntil: 'load', timeout: 90_000 });
    await page.bringToFront();
    await sleep(9000);
    const bs = await botones(page);
    // Solo los que tienen caja de botón: los enlaces de texto corrido no vienen al caso.
    tabla(
      'REFERENCIA · good-fella.com',
      bs.filter((b) => b.alto >= 28 || /work|brief|contact|menu/i.test(b.texto)),
    );
    writeFileSync(join(OUT, 'botones-ref.json'), JSON.stringify(bs), 'utf8');
    await ctx.close();
  }

  say('');

  {
    const { startPreview } = await import('./lib/preview.ts');
    const preview = startPreview(PUERTO);
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://localhost:${PUERTO}/`)).ok) break;
      } catch {
        /* aún no */
      }
      await sleep(400);
    }
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'load' });
    await page.bringToFront();
    await sleep(3000);
    const bs = await botones(page);
    tabla('NUESTRO', bs);
    writeFileSync(join(OUT, 'botones-nuestro.json'), JSON.stringify(bs), 'utf8');
    await ctx.close();
    preview.stop();
  }

  await browser.close();
  writeFileSync(join(OUT, 'botones.txt'), L.join('\n'), 'utf8');
  say('');
  say(`Guardado en ${join(OUT, 'botones.txt')}`);
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
