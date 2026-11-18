// scripts/recon-tipografia.ts — la jerarquía tipográfica de la referencia contra la nuestra.
//
// Punto 2 de la ronda de pulido: Javier sospecha que nuestro display es proporcionalmente más
// grande respecto al body de lo que es en la referencia. Eso no se decide mirando: se miden los
// tamaños REALES —los computados, con la fuente cargada y a un ancho concreto— en los dos sitios
// con el mismo código y en el mismo viewport.
//
// Lo que importa no es el número suelto sino la RELACIÓN: un display de 88 px no dice nada sin
// saber que el body es de 16. Por eso la tabla lleva la razón display/body, que es la que fija
// cómo de agresiva se siente la jerarquía.
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve('recon');
const REF = 'https://good-fella.com/';
const NUESTRO_PUERTO = 4278;
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

interface Medida {
  rol: string;
  px: number;
  lh: number;
  ls: number;
  peso: string;
  familia: string;
  muestra: string;
}

/**
 * Mide los roles tipográficos de una página. Los selectores se pasan por rol para poder apuntar
 * a la estructura de cada sitio sin cambiar el criterio de medida.
 */
async function medir(page: Page, roles: Array<[string, string]>): Promise<Medida[]> {
  return (await page.evaluate(
    `((roles) => roles.map(([rol, sel]) => {
        // Selector especial: "@texto" busca el bloque con MÁS texto corrido de la página, que es
      // lo que de verdad hace de cuerpo. Con un selector fijo como 'p' se cuela cualquier
      // etiqueta suelta —en la referencia salió "Contact", de 7 caracteres— y la razón
      // display/body deja de significar nada, que es justo lo que hay que comparar.
      const el = sel === '@texto'
        ? Array.from(document.querySelectorAll('p, li, div'))
            .filter((e) => {
              const t = (e.textContent || '').trim();
              if (t.length < 80) return false;
              // Solo bloques hoja: si tiene hijos con texto, se estaría midiendo el contenedor.
              return !Array.from(e.children).some((c) => (c.textContent || '').trim().length > 40);
            })
            .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0]
        : document.querySelector(sel);
      if (!el) return { rol, px: 0, lh: 0, ls: 0, peso: '-', familia: '-', muestra: 'NO ENCONTRADO' };
      const cs = getComputedStyle(el);
      const px = parseFloat(cs.fontSize);
      const lh = cs.lineHeight === 'normal' ? px * 1.2 : parseFloat(cs.lineHeight);
      return {
        rol,
        px: Math.round(px * 10) / 10,
        lh: Math.round((lh / px) * 1000) / 1000,
        ls: Math.round((parseFloat(cs.letterSpacing) || 0) / px * 1000) / 1000,
        peso: cs.fontWeight,
        familia: cs.fontFamily.split(',')[0].replace(/["']/g, '').slice(0, 18),
        muestra: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 26),
      };
    }))(${JSON.stringify(roles)})`,
  )) as Medida[];
}

function tabla(titulo: string, ms: Medida[]): void {
  const body = ms.find((m) => m.rol === 'body')?.px ?? 16;
  say(`   ${titulo}`);
  say('   rol         px     /body    lh      ls      peso   familia          muestra');
  for (const m of ms) {
    if (m.px === 0) {
      say(`   ${m.rol.padEnd(10)} ${'—'.padStart(6)}   (no encontrado)`);
      continue;
    }
    say(
      `   ${m.rol.padEnd(10)} ${m.px.toFixed(1).padStart(6)} ${(m.px / body).toFixed(2).padStart(7)}  ${m.lh.toFixed(2).padStart(5)}  ${m.ls.toFixed(3).padStart(6)}  ${m.peso.padStart(5)}   ${m.familia.padEnd(16)} "${m.muestra}"`,
    );
  }
}

try {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium
    .launch({ channel: 'chrome', headless: false })
    .catch(() => chromium.launch({ headless: false }));

  say('== JERARQUÍA TIPOGRÁFICA · referencia contra nosotros, a 1440 px ==');
  say('   px = tamaño computado · /body = cuántas veces el cuerpo de texto');
  say('   lh = interlineado relativo · ls = tracking en em (negativo = apretado)');
  say('');

  // ---------------------------------------------------------------- la referencia
  {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(REF, { waitUntil: 'load', timeout: 90_000 });
    await page.bringToFront();
    await sleep(9000);
    const ms = await medir(page, [
      ['display', 'h1'],
      ['h2', 'h2'],
      ['h3', 'h3'],
      ['hero-sub', 'h1 + p, h1 ~ p'],
      ['body', '@texto'],
      ['label', '[class*=text-accent]'],
    ]);
    tabla('REFERENCIA · good-fella.com', ms);
    writeFileSync(join(OUT, 'tipografia-ref.json'), JSON.stringify(ms), 'utf8');
    await ctx.close();
  }

  say('');

  // ---------------------------------------------------------------- el nuestro
  {
    const { startPreview } = await import('./lib/preview.ts');
    const preview = startPreview(NUESTRO_PUERTO);
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://localhost:${NUESTRO_PUERTO}/`)).ok) break;
      } catch {
        /* aún no */
      }
      await sleep(400);
    }
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${NUESTRO_PUERTO}/`, { waitUntil: 'load' });
    await page.bringToFront();
    await sleep(3000);
    const ms = await medir(page, [
      ['display', '[data-hero-title]'],
      ['h2', '[data-section] h2'],
      ['h3', '.process__step-title, .principles__item h3, h3'],
      ['body', '@texto'],
      ['hero-sub', '[data-hero-sub]'],
      ['label', '.section__eyebrow, [class*=eyebrow], [class*=label]'],
    ]);
    tabla('NUESTRO', ms);
    writeFileSync(join(OUT, 'tipografia-nuestro.json'), JSON.stringify(ms), 'utf8');
    await ctx.close();
    preview.stop();
  }

  await browser.close();
  writeFileSync(join(OUT, 'tipografia.txt'), L.join('\n'), 'utf8');
  say('');
  say(`Guardado en ${join(OUT, 'tipografia.txt')}`);
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
