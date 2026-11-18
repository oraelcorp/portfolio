// scripts/recon-scrolly.ts — el scrollytelling de "How we work" de la referencia, medido.
//
// Tres preguntas de Javier, y las tres se contestan con el mismo método: recorrer la sección en
// pasos pequeños de scroll y anotar en cada uno el estado de los elementos. Un efecto atado al
// scroll no se mide con el reloj: se mide con la barra.
//
//   1. El cubito, ¿GIRA o solo se inclina? Se guarda la matriz de transformación cruda y se
//      descompone en Node — un `rotate` de 2D y un `rotateX/Y` de 3D se distinguen ahí, no a ojo.
//   2. Las cuatro imágenes, ¿crossfade en el sitio o carrusel que se desplaza? Se miran opacidad
//      Y posición: si cambia la opacidad y no la caja, es crossfade; si se mueve, es carrusel.
//   3. El scroll, ¿tiene snap o resistencia? Se empuja con la RUEDA y se mira dónde acaba
//      quedándose: si hay snap, los reposos caen en posiciones discretas.
//
// Precedente reciente que conviene tener presente: el hover de los proyectos no se dispara bajo
// automatización. Este sí debería —el barrido de los titulares se dispara por scroll sin
// problema— pero si la primera pasada sale plana, se dice y se para.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL = 'https://good-fella.com/';
const OUT = resolve('recon');
/** Tamaño del paso del recorrido, en px. Fino: lo que se busca es la curva, no el destino. */
const PASO = 60;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 9 * 60 * 1000;
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

/** Descompone una matriz CSS en grados de giro y escala. Distingue 2D de 3D. */
function descomponer(t: string): { rot: number; escala: number; tipo: string } | null {
  if (!t || t === 'none') return null;
  const n = t.match(/matrix(3d)?\(([^)]+)\)/);
  if (!n) return null;
  const v = n[2]!.split(',').map(Number);
  if (n[1]) {
    // matrix3d: el giro en Z sale de los dos primeros de la primera columna.
    const rot = (Math.atan2(v[1]!, v[0]!) * 180) / Math.PI;
    const escala = Math.hypot(v[0]!, v[1]!);
    // Si hay componentes fuera del plano, hay giro 3D de verdad.
    const fuera = Math.abs(v[2]!) + Math.abs(v[6]!) + Math.abs(v[8]!) + Math.abs(v[9]!);
    return { rot, escala, tipo: fuera > 0.001 ? '3D' : '2D(en matrix3d)' };
  }
  return {
    rot: (Math.atan2(v[1]!, v[0]!) * 180) / Math.PI,
    escala: Math.hypot(v[0]!, v[1]!),
    tipo: '2D',
  };
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
  await sleep(9000);

  // ------------------------------------------------------------ 1. estructura
  const seccion = (await page.evaluate(`(() => {
    const h = Array.from(document.querySelectorAll('h2')).find((e) => /how we work/i.test(e.textContent || ''));
    if (!h) return null;
    const sec = h.closest('section') || h.parentElement;
    const r = sec.getBoundingClientRect();
    const pegados = [];
    const imagenes = [];
    const cuadros = [];
    for (const el of sec.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      if (cs.position === 'sticky' || cs.position === 'fixed') {
        pegados.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 44), pos: cs.position, top: cs.top, w: Math.round(b.width), h: Math.round(b.height) });
      }
      if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || /image|media|figure/i.test((el.className || '').toString())) {
        imagenes.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 44), src: (el.getAttribute('src') || el.getAttribute('data-src') || '').slice(-40), w: Math.round(b.width), h: Math.round(b.height), op: cs.opacity });
      }
      // El "cubito": elemento pequeño y cuadrado con fondo.
      if (b.width > 4 && b.width < 60 && Math.abs(b.width - b.height) < 6 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        cuadros.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 44), w: Math.round(b.width), h: Math.round(b.height), bg: cs.backgroundColor, transform: cs.transform });
      }
    }
    return {
      yPagina: Math.round(r.top + window.scrollY),
      alto: Math.round(r.height),
      pegados: pegados.slice(0, 10),
      imagenes: imagenes.slice(0, 12),
      cuadros: cuadros.slice(0, 10),
      pasos: sec.querySelectorAll('h3').length,
    };
  })()`)) as Record<string, unknown> | null;

  if (!seccion) throw new Error('no se encontró la sección');

  say('== ESTRUCTURA DE "HOW WE WORK" ==');
  say(`   sección en y=${seccion.yPagina}, alto ${seccion.alto} px · ${seccion.pasos} titulares h3`);
  say('   elementos PEGADOS (sticky/fixed):');
  for (const p of seccion.pegados as Array<Record<string, unknown>>) say(`      ${JSON.stringify(p)}`);
  say('   imágenes / medios:');
  for (const i of seccion.imagenes as Array<Record<string, unknown>>) say(`      ${JSON.stringify(i)}`);
  say('   cuadros pequeños (candidatos a "cubito"):');
  for (const c of seccion.cuadros as Array<Record<string, unknown>>) say(`      ${JSON.stringify(c)}`);
  say('');

  // ------------------------------------------------------------ 2. recorrido por pasos
  const y0 = Number(seccion.yPagina) - 900;
  const y1 = Number(seccion.yPagina) + Number(seccion.alto) + 200;
  say(`== RECORRIDO · de y=${y0} a y=${y1} en pasos de ${PASO} px ==`);
  say('');

  const muestras: Array<Record<string, unknown>> = [];
  for (let y = y0; y <= y1; y += PASO) {
    await page.evaluate(`window.scrollTo(0, ${y})`);
    await sleep(140);
    const m = (await page.evaluate(`(() => {
      const h = Array.from(document.querySelectorAll('h2')).find((e) => /how we work/i.test(e.textContent || ''));
      const sec = h.closest('section') || h.parentElement;
      const cuadros = [];
      const medios = [];
      for (const el of sec.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        if (b.width > 4 && b.width < 60 && Math.abs(b.width - b.height) < 6 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          cuadros.push({ t: cs.transform, op: cs.opacity, x: Math.round(b.left), y: Math.round(b.top) });
        }
        if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
          medios.push({ src: (el.getAttribute('src') || '').slice(-24), op: cs.opacity, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), t: cs.transform });
        }
      }
      return { scrollY: Math.round(window.scrollY), cuadros: cuadros.slice(0, 3), medios: medios.slice(0, 6) };
    })()`)) as Record<string, unknown>;
    muestras.push(m);
  }

  // ------------------------------------------------------------ 3. informe
  say('   scrollY   cubito: giro / escala / pos      medios (opacidad · x)');
  for (const m of muestras) {
    const c = (m.cuadros as Array<Record<string, string>>)[0];
    const d = c ? descomponer(c.t ?? '') : null;
    const medios = (m.medios as Array<Record<string, string | number>>)
      .map((x) => `${Number(x.op).toFixed(2)}@${x.x}`)
      .join(' ');
    say(
      `   ${String(m.scrollY).padStart(7)}   ${d ? `${d.rot.toFixed(1).padStart(7)}° ${d.escala.toFixed(2)} ${d.tipo.padEnd(14)} ${c!.x},${c!.y}` : '—'.padEnd(34)}  ${medios}`,
    );
  }

  // ------------------------------------------------------------ 4. ¿hay snap o resistencia?
  // Se empuja con la RUEDA —no con scrollTo, que salta y no deja inercia— y se mira dónde se
  // queda. Con snap, los reposos caen en posiciones discretas y el desplazamiento final no
  // coincide con lo empujado; sin snap, se queda donde la inercia lo deje.
  say('');
  say('== ¿SNAP O RESISTENCIA? · empujones de rueda dentro de la sección ==');
  say('   empuje   antes      después   desplazado   deriva tras soltar');
  for (const delta of [120, 240, 400, 240, 120]) {
    await page.evaluate(`window.scrollTo(0, ${Number(seccion.yPagina) + 900})`);
    await sleep(1200);
    const antes = (await page.evaluate('Math.round(window.scrollY)')) as number;
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, delta);
    await sleep(220);
    const justo = (await page.evaluate('Math.round(window.scrollY)')) as number;
    await sleep(1600);
    const despues = (await page.evaluate('Math.round(window.scrollY)')) as number;
    say(
      `   ${String(delta).padStart(6)}   ${String(antes).padStart(7)}   ${String(despues).padStart(7)}   ${String(despues - antes).padStart(10)}   ${String(despues - justo).padStart(8)} px`,
    );
  }

  writeFileSync(join(OUT, 'scrolly.json'), JSON.stringify({ seccion, muestras }), 'utf8');
  writeFileSync(join(OUT, 'scrolly.txt'), L.join('\n'), 'utf8');
  say('');
  say(`Guardado en ${join(OUT, 'scrolly.txt')}`);
  await ctx.close();
  await browser.close();
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
