// scripts/recon-texto.ts — ¿qué pasa EXACTAMENTE cuando entra el texto de una sección en la
// referencia?
//
// Javier lo describe a ojo —texto, recuadro, destello naranja, blanco, naranja, texto limpio— y
// avisa de que es demasiado rápido para fiarse de esa lectura. Así que no se reconstruye de la
// descripción: se mide.
//
// La técnica es la que funcionó con el preloader (`recon-spinner2.ts`): **muestrear estilos
// calculados dentro de la página**, no capturar pantallas. Motivos, todos aprendidos a golpes en
// este proyecto:
//   · la ráfaga de capturas contra la referencia llega a 8 fps, y un efecto de medio segundo se
//     queda en cuatro fotogramas;
//   · `recordVideo` de Playwright deja su página a medias (medido: el hero no llega a pintar);
//   · y un muestreo por rAF va a 60 Hz, ve el orden real y además da los VALORES —colores,
//     transformaciones, clip-path— en vez de hacer que los adivine el ojo.
//
// Dos fases: DESCUBRIR la estructura del bloque de texto (incluidos pseudo-elementos, que es
// donde suele vivir un "recuadro") y GRABAR la línea de tiempo de sus propiedades mientras entra.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');
/** Cuánto se graba tras disparar la entrada. El efecto cabe de sobra. */
const GRABAR_MS = 2600;

const TOPE_MS = 6 * 60 * 1000;
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

/** Propiedades que puede tocar un efecto de entrada de texto. Se muestrean todas. */
const PROPS = [
  'opacity',
  'transform',
  'clipPath',
  'backgroundColor',
  'color',
  'width',
  'height',
  'visibility',
  'filter',
  'mixBlendMode',
  'transformOrigin',
];

interface Muestra {
  t: number;
  v: Record<string, Record<string, string>>;
}

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

  // ---------------------------------------------------------------- 1. descubrir
  const mapa = (await page.evaluate(`(() => {
    const fuera = [];
    const vistos = new Set();
    for (const el of document.querySelectorAll('h1, h2, h3, [class*=title], [class*=heading]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 10) continue;
      const texto = (el.textContent || '').trim().slice(0, 48);
      if (!texto || vistos.has(texto)) continue;
      vistos.add(texto);
      const antes = getComputedStyle(el, '::before');
      const despues = getComputedStyle(el, '::after');
      const pseudo = (p) => ({
        content: p.content,
        bg: p.backgroundColor,
        w: p.width,
        h: p.height,
        transform: p.transform,
        opacity: p.opacity,
        position: p.position,
      });
      fuera.push({
        tag: el.tagName,
        cls: el.className && el.className.toString().slice(0, 80),
        texto,
        yPagina: Math.round(r.top + window.scrollY),
        enPantalla: r.top < innerHeight && r.bottom > 0,
        hijos: Array.from(el.children).map((c) => c.tagName + '.' + (c.className || '').toString().slice(0, 40)).slice(0, 6),
        before: pseudo(antes),
        after: pseudo(despues),
        overflow: getComputedStyle(el).overflow,
        clip: getComputedStyle(el).clipPath,
      });
    }
    return fuera;
  })()`)) as Array<Record<string, unknown>>;

  say('== ESTRUCTURA DE LOS BLOQUES DE TEXTO DE LA REFERENCIA ==');
  for (const m of mapa) {
    say(
      `   ${String(m.tag).padEnd(3)} y=${String(m.yPagina).padStart(6)} ${m.enPantalla ? '(en pantalla)' : '             '} "${m.texto}"`,
    );
    say(`       clases: ${m.cls}`);
    if (Array.isArray(m.hijos) && m.hijos.length) say(`       hijos:  ${m.hijos.join(' · ')}`);
    const b = m.before as Record<string, string>;
    const a = m.after as Record<string, string>;
    if (b.content !== 'none') say(`       ::before ${JSON.stringify(b)}`);
    if (a.content !== 'none') say(`       ::after  ${JSON.stringify(a)}`);
    if (m.clip !== 'none') say(`       clip-path: ${m.clip}`);
  }
  say('');

  // ---------------------------------------------------------------- 2. grabar la entrada
  // Se elige el primer bloque que AÚN NO haya entrado en pantalla: el efecto se dispara una vez.
  const objetivo = (mapa.find((m) => !m.enPantalla) ?? mapa[mapa.length - 1]) as Record<string, unknown>;
  say(`== LÍNEA DE TIEMPO DE LA ENTRADA · objetivo: "${objetivo.texto}" (y=${objetivo.yPagina}) ==`);
  say(`   muestreo por requestAnimationFrame · ${GRABAR_MS} ms`);
  say('');

  const datos = (await page.evaluate(
    `(({ texto, props, ms }) => new Promise((resolve) => {
    const raiz = Array.from(document.querySelectorAll('h1, h2, h3, [class*=title], [class*=heading]'))
      .find((e) => (e.textContent || '').trim().slice(0, 48) === texto);
    if (!raiz) return resolve({ error: 'no se encontró el objetivo' });

    // Se vigila la raíz, sus descendientes y los pseudo-elementos de cada uno: el "recuadro"
    // puede ser cualquiera de las tres cosas.
    const nodos = [raiz, ...Array.from(raiz.querySelectorAll('*'))].slice(0, 24);
    const etiqueta = (el, i) => i === 0 ? 'raiz' : (el.tagName + '#' + i + '.' + (el.className || '').toString().trim().split(/\\s+/)[0] || '').slice(0, 34);

    const muestras = [];
    const leer = () => {
      const v = {};
      nodos.forEach((el, i) => {
        for (const [suf, pseudo] of [['', null], ['::before', '::before'], ['::after', '::after']]) {
          const cs = getComputedStyle(el, pseudo);
          if (pseudo && cs.content === 'none') continue;
          const o = {};
          for (const p of props) o[p] = cs[p];
          if (pseudo) o.content = cs.content;
          v[etiqueta(el, i) + suf] = o;
        }
      });
      return v;
    };

    // El disparo: se lleva el bloque a pantalla. Se graba desde ANTES para tener el estado de
    // partida, que es justo lo que se pierde si uno mira cuando ya ha empezado.
    const t0 = performance.now();
    muestras.push({ t: 0, v: leer() });
    raiz.scrollIntoView({ behavior: 'instant', block: 'center' });
    const paso = () => {
      const t = performance.now() - t0;
      muestras.push({ t, v: leer() });
      if (t < ms) requestAnimationFrame(paso);
      else resolve({ muestras });
    };
    requestAnimationFrame(paso);
  }))(${JSON.stringify({ texto: objetivo.texto, props: PROPS, ms: GRABAR_MS })})`,
  )) as { muestras?: Muestra[]; error?: string };

  if (datos.error || !datos.muestras) {
    say(`   ERROR: ${datos.error}`);
  } else {
    const ms = datos.muestras;
    say(`   ${ms.length} muestras en ${ms[ms.length - 1]!.t.toFixed(0)} ms`);
    say('');
    // Se reporta solo lo que CAMBIA: una tabla de valores constantes no dice nada.
    const claves = new Set<string>();
    for (const m of ms) for (const k of Object.keys(m.v)) claves.add(k);
    for (const k of [...claves].sort()) {
      for (const p of [...PROPS, 'content']) {
        const serie = ms.map((m) => ({ t: m.t, val: m.v[k]?.[p] }));
        const definidos = serie.filter((s) => s.val !== undefined);
        if (definidos.length === 0) continue;
        const distintos = [...new Set(definidos.map((s) => s.val))];
        if (distintos.length < 2) continue;
        say(`   ${k} · ${p}`);
        let anterior: string | undefined;
        for (const s of definidos) {
          if (s.val === anterior) continue;
          anterior = s.val;
          say(`       ${s.t.toFixed(0).padStart(6)} ms   ${String(s.val).slice(0, 96)}`);
        }
      }
    }
    writeFileSync(join(OUT, 'texto-entrada.json'), JSON.stringify(datos.muestras), 'utf8');
  }

  writeFileSync(join(OUT, 'texto-entrada.txt'), L.join('\n'), 'utf8');
  say('');
  say(`Guardado en ${join(OUT, 'texto-entrada.txt')}`);
  await ctx.close();
  await browser.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
