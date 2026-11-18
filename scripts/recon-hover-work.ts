// scripts/recon-hover-work.ts — ¿qué pasa al pasar el cursor sobre un proyecto de la referencia?
//
// Javier lo describe como "aparece un cubito y las letras hacen un glitch". Las dos mitades hay
// que confirmarlas por separado, y hay una pregunta concreta debajo: **¿es un scramble de
// caracteres —que ya tenemos en el proyecto— o una distorsión visual?** Son cosas distintas y se
// distinguen con un dato, no a ojo:
//
//   · si el TEXTO cambia a lo largo del tiempo → scramble de caracteres;
//   · si el texto NO cambia pero sí `transform`/`clip-path` → swap por desplazamiento;
//   · si lo que cambia es `filter` o `text-shadow` → glitch/RGB shift de verdad.
//
// La pista previa: la sonda de texto vio que estos títulos llevan el contenido DUPLICADO en el
// DOM ("Custom code.Custom code."), que es firma de swap, no de scramble. Aquí se comprueba.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');
const GRABAR_MS = 1600;

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

const PROPS = [
  'transform',
  'opacity',
  'color',
  'filter',
  'textShadow',
  'clipPath',
  'backgroundColor',
  'width',
  'height',
  'letterSpacing',
];

try {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium
    .launch({ channel: 'chrome', headless: false })
    .catch(() => chromium.launch({ headless: false }));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 90_000 });
  await page.bringToFront();
  await page.waitForTimeout(9000);

  // ------------------------------------------------------------ 1. estructura en reposo
  const estructura = (await page.evaluate(`(() => {
    // Se exige CAJA REAL. La primera versión filtraba por clase (/accent/) y cogió una lista
    // que mide 0x0 —marcado duplicado que el sitio tiene oculto—, así que el hover no tocaba
    // nada y la tabla salía vacía dos veces seguidas. Lo que se puede señalar con el ratón es lo
    // que tiene tamaño en pantalla.
    const items = Array.from(document.querySelectorAll('h3'))
      .filter((h) => {
        const r = h.getBoundingClientRect();
        return r.width > 40 && r.height > 10;
      })
      .slice(0, 8);
    return items.map((h) => {
      const r = h.getBoundingClientRect();
      const antes = getComputedStyle(h, '::before');
      const despues = getComputedStyle(h, '::after');
      return {
        texto: (h.textContent || '').trim().slice(0, 40),
        cls: (h.className || '').toString().slice(0, 46),
        y: Math.round(r.top + window.scrollY),
        hijos: Array.from(h.children).map(
          (c) => c.tagName + '.' + (c.className || '').toString().slice(0, 26) + ' «' + (c.textContent || '').trim().slice(0, 18) + '»',
        ),
        overflow: getComputedStyle(h).overflow,
        before: antes.content === 'none' ? null : { content: antes.content, bg: antes.backgroundColor, w: antes.width, h: antes.height },
        after: despues.content === 'none' ? null : { content: despues.content, bg: despues.backgroundColor, w: despues.width, h: despues.height },
      };
    });
  })()`)) as Array<Record<string, unknown>>;

  say('== LISTA DE PROYECTOS EN REPOSO ==');
  for (const e of estructura) {
    say(`   "${e.texto}"  y=${e.y}`);
    say(`      clases: ${e.cls} · overflow: ${e.overflow}`);
    if (Array.isArray(e.hijos) && e.hijos.length) for (const h of e.hijos) say(`      hijo: ${h}`);
    if (e.before) say(`      ::before ${JSON.stringify(e.before)}`);
    if (e.after) say(`      ::after  ${JSON.stringify(e.after)}`);
  }
  say('');

  // ------------------------------------------------------------ 2. el hover, frame a frame
  // Cuál medir se elige por argumento: el primero del documento son los pasos del proceso, y lo
  // que interesa aquí es la lista de proyectos.
  const pedido = process.argv[2] ?? '';
  const objetivo = (estructura.find((e) => String(e.texto).startsWith(pedido)) ?? estructura[0]) as Record<
    string,
    unknown
  >;
  // Se usa el LOCATOR de Playwright en vez de coordenadas calculadas a mano. Es lo que
  // resuelve de una vez el problema que ha tumbado tres versiones de esta sonda: el sitio tiene
  // DOS elementos con el mismo título y uno mide 0x0, así que buscar por texto daba el
  // equivocado, el `scrollTo` no confirmaba nada y el ratón acababa en (0,0) — o sea, en el
  // header. `:visible` filtra por caja real y `hover()` se encarga de traerlo a la vista y de
  // poner el puntero encima de verdad.
  const item = page
    .locator('h3:visible')
    .filter({ hasText: String(objetivo.texto) })
    .first();
  await item.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await item.hover();
  await page.waitForTimeout(60);
  const b = await item.boundingBox();
  const caja = { x: (b?.x ?? 0) + (b?.width ?? 0) / 2, y: (b?.y ?? 0) + (b?.height ?? 0) / 2 };

  const muestreo = page.evaluate(
    `(({ props, ms, px, py }) => new Promise((resolve) => {
      const bajo = document.elementFromPoint(px, py);
      const h = (bajo && bajo.closest('h3')) || bajo;
      if (!h) return resolve({ error: 'nada bajo el puntero' });
      const fila = h.closest('li, a, article, div') || h;
      const leer = () => {
        const nodos = [fila, h, ...Array.from(h.querySelectorAll('*'))].slice(0, 18);
        const v = {};
        nodos.forEach((el, i) => {
          const cs = getComputedStyle(el);
          const o = { texto: (el.textContent || '').trim().slice(0, 44) };
          for (const p of props) o[p] = cs[p];
          const etq = ('n' + String(i).padStart(2, '0') + '.' + el.tagName + '.' + (el.className || '').toString().trim().split(/ +/)[0]).slice(0, 34);
          v[etq] = o;
          for (const pseudo of ['::before', '::after']) {
            const ps = getComputedStyle(el, pseudo);
            if (ps.content === 'none') continue;
            const po = { texto: ps.content };
            for (const p of props) po[p] = ps[p];
            v[(etq + pseudo).slice(0, 42)] = po;
          }
        });
        v['__fila'] = { texto: String(fila.querySelectorAll('*').length) };
        return v;
      };
      const muestras = [];
      const t0 = performance.now();
      const paso = () => {
        const t = performance.now() - t0;
        muestras.push({ t, v: leer() });
        if (t < ms) requestAnimationFrame(paso);
        else resolve({ muestras });
      };
      requestAnimationFrame(paso);
    }))(${JSON.stringify({ props: PROPS, ms: GRABAR_MS, px: 0, py: 0 })})`.replace(
      '"px":0,"py":0',
      `"px":${caja.x},"py":${caja.y}`,
    ),
  );

  // Se sale y se vuelve a entrar para capturar el efecto desde su arranque con el muestreo ya
  // corriendo: entrar una sola vez deja el efecto a medias antes del primer fotograma.
  await page.mouse.move(caja.x - 200, caja.y - 120);
  await page.waitForTimeout(120);
  await page.mouse.move(caja.x, caja.y, { steps: 8 });

  // Diagnóstico de que el puntero llegó donde se cree: sin esto, "no cambia nada" es
  // indistinguible de "no estoy tocando el elemento", y ya pasó dos veces en esta sonda.
  await page.waitForTimeout(500);
  const donde = (await page.evaluate(`(() => {
    const hov = Array.from(document.querySelectorAll(':hover')).slice(-4)
      .map((e) => e.tagName + '.' + (e.className || '').toString().trim().split(/ +/).slice(0, 2).join('.')).join('  >  ');
    const h = Array.from(document.querySelectorAll('h3')).find((e) => (e.textContent || '').trim().slice(0, 40) === ${JSON.stringify(objetivo.texto)});
    const r = h.getBoundingClientRect();
    const fila = h.closest('a, li, article') || h.parentElement;
    return { hov, rect: Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height),
             fila: fila.tagName + '.' + (fila.className || '').toString().slice(0, 40),
             html: fila.outerHTML.slice(0, 620) };
  })()`)) as Record<string, string>;
  say(`   puntero sobre: ${donde.hov}`);
  say(`   caja del objetivo: ${donde.rect}`);
  say(`   fila: ${donde.fila}`);
  say(`   html de la fila: ${donde.html}`);
  say('');

  const datos = (await muestreo) as {
    muestras?: Array<{ t: number; v: Record<string, Record<string, string>> }>;
    error?: string;
  };

  if (datos.error || !datos.muestras) {
    say(`   ERROR: ${datos.error}`);
  } else {
    const ms = datos.muestras;
    say(
      `== HOVER SOBRE "${objetivo.texto}" · ${ms.length} muestras en ${Math.round(ms[ms.length - 1]!.t)} ms ==`,
    );
    say('');
    const claves = new Set<string>();
    for (const m of ms) for (const k of Object.keys(m.v)) claves.add(k);
    for (const k of [...claves].sort()) {
      for (const p of ['texto', ...PROPS, 'hijos', 'html']) {
        const serie = ms.map((m) => ({ t: m.t, val: m.v[k]?.[p] })).filter((s) => s.val !== undefined);
        if (serie.length === 0) continue;
        if (new Set(serie.map((s) => s.val)).size < 2) continue;
        say(`   ${k} · ${p}`);
        let ant: unknown;
        for (const s of serie) {
          if (s.val === ant) continue;
          ant = s.val;
          say(`       ${String(Math.round(s.t)).padStart(5)} ms   ${String(s.val).slice(0, 88)}`);
        }
      }
    }
    writeFileSync(join(OUT, 'hover-work.json'), JSON.stringify(ms), 'utf8');
  }

  writeFileSync(join(OUT, 'hover-work.txt'), L.join('\n'), 'utf8');
  say('');
  say(`Guardado en ${join(OUT, 'hover-work.txt')}`);
  await ctx.close();
  await browser.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
