// scripts/record-hover.ts — el hover de un proyecto de la referencia, grabado a cámara lenta.
//
// Por qué en vídeo y no muestreando estilos: la sonda de `recon-hover-work.ts` llegó a poner el
// puntero sobre el elemento correcto —lo confirma la cadena de `:hover`— y aun así no capturó un
// solo cambio en 78 muestras. O el efecto no se dispara bajo automatización, o cuelga de algo que
// el muestreo no ve. El vídeo no necesita saber CÓMO está hecho: graba lo que se ve.
//
// Con el reloj de rAF ralentizado ×4 (`RELOJ_LENTO`), un scramble de 400 ms pasa a durar 1.6 s y
// la ráfaga le saca fotogramas intermedios suficientes para leer la dirección en que resuelve.
//
// El ratón entra con un recorrido de varios pasos, no de un salto: si el efecto depende de
// `mousemove` con desplazamiento real, un teletransporte al centro no lo dispara.
import { chromium } from 'playwright';
import { rafagaAMp4, RELOJ_LENTO, type Caja } from './lib/video.ts';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Tercer argumento `local` graba NUESTRA página en vez de la referencia. */
const LOCAL = process.argv[3] === 'local';
const PUERTO = 4282;
const URL = LOCAL ? `http://localhost:${PUERTO}/` : 'https://good-fella.com/';
const OUT = resolve('screenshots', 'hover');
const TMP = join(OUT, 'tmp');
const LENTO = 4;
const GRABAR_MS = 7000;
/** Margen alrededor de la fila: el "cubito" puede aparecer fuera de la caja del título. */
const MARGEN = { x: 220, y: 90 };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TOPE_MS = 10 * 60 * 1000;
const guardian = setTimeout(() => {
  console.error(`FATAL: la sonda pasó de ${TOPE_MS / 1000}s. Se corta para no dejar huérfanos.`);
  process.exit(1);
}, TOPE_MS);
guardian.unref?.();

/** El servidor de vista previa solo existe en modo local; se para en el `finally`. */
let preview: { stop: () => void } | null = null;

try {
  mkdirSync(OUT, { recursive: true });
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  if (LOCAL) {
    const { startPreview } = await import('./lib/preview.ts');
    preview = startPreview(PUERTO);
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(URL)).ok) break;
      } catch {
        /* aún no */
      }
      await sleep(400);
    }
  }
  const browser = await chromium
    .launch({ channel: 'chrome', headless: false })
    .catch(() => chromium.launch({ headless: false }));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(RELOJ_LENTO(LENTO));
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 90_000 });
  await page.bringToFront();
  // Con el reloj lento su carga también se estira: se espera de sobra.
  // Con el reloj lento la carga también se estira. En local hace falta menos margen.
  await sleep(LOCAL ? 9000 : 16_000);
  if (LOCAL) {
    // El preloader se consume en una primera pasada: si no, se come la grabación entera.
    await page
      .waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 90_000 })
      .catch(() => {});
  }

  const titulo = process.argv[2] ?? 'BodyArmor';
  // Diagnóstico antes de localizar: "no encuentro el elemento" puede ser que no exista, que no
  // haya renderizado aún o que siga tapado por el preloader, y son tres arreglos distintos.
  const estado = (await page.evaluate(`(() => ({
    previews: document.querySelectorAll('[data-work-preview]').length,
    h3: document.querySelectorAll('[data-work-preview] .work__meta h3').length,
    textos: Array.from(document.querySelectorAll('[data-work-preview] .work__meta h3')).map((h) => (h.textContent || '').trim()).join(' | '),
    preloader: !!document.querySelector('[data-preloader]'),
  }))()`)) as Record<string, unknown>;
  console.log(`   estado: ${JSON.stringify(estado)}`);
  // NADA de locators aquí, y por dos motivos distintos:
  //   · en la referencia, el título está DUPLICADO y una copia mide 0x0;
  //   · en nuestra página, los proyectos entran con `autoAlpha: 0`, así que hasta que el reveal
  //     los enciende son invisibles para Playwright y el locator se queda esperando para
  //     siempre (30 s de timeout, dos veces seguidas).
  // Con `page.evaluate` y un filtro de caja real se resuelven los dos casos con el mismo código.
  const sel = LOCAL ? '[data-work-preview] .work__meta h3' : 'h3';
  const buscar = `(() => {
    const el = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter((e) => {
      const r = e.getBoundingClientRect();
      return (e.textContent || '').includes(${JSON.stringify(titulo)}) && r.height > 8 && r.width > 30;
    })[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, yPag: r.top + window.scrollY };
  })()`;

  // Primero se lleva la sección a la vista para que el reveal se dispare y el elemento exista
  // con caja; solo entonces tiene sentido medirlo.
  const ancla = (await page.evaluate(
    `(() => { const s = document.querySelector(${JSON.stringify(LOCAL ? '[data-section="work"]' : 'h3')});
      return s ? Math.round(s.getBoundingClientRect().top + window.scrollY) : 0; })()`,
  )) as number;
  interface CajaTitulo {
    x: number;
    y: number;
    w: number;
    h: number;
    yPag: number;
  }
  let b: CajaTitulo | null = null;
  for (let intento = 0; intento < 30; intento++) {
    await page.evaluate(`window.scrollTo(0, ${Math.max(0, ancla - 200 + intento * 120)})`);
    await sleep(500);
    b = (await page.evaluate(buscar)) as CajaTitulo | null;
    if (b && b.y > 80 && b.y + b.h < 820) break;
  }
  if (!b) throw new Error('sin caja para ' + titulo);
  await sleep(1000);
  b = (await page.evaluate(buscar)) as CajaTitulo | null;
  if (!b) throw new Error('sin caja para ' + titulo);
  const centro = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  console.log(
    `   "${titulo}" en ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`,
  );

  const clip: Caja = {
    x: Math.max(0, b.x - MARGEN.x),
    y: Math.max(0, b.y - MARGEN.y),
    w: Math.min(1440 - Math.max(0, b.x - MARGEN.x), b.w + MARGEN.x * 2),
    h: Math.min(900 - Math.max(0, b.y - MARGEN.y), b.h + MARGEN.y * 2),
  };

  // La ráfaga arranca ANTES de entrar, para tener el estado en reposo en los primeros
  // fotogramas: sin eso no se puede decir qué apareció y qué ya estaba.
  const t0 = Date.now();
  let i = 0;
  const capturar = async (): Promise<number> => {
    while (Date.now() - t0 < GRABAR_MS) {
      try {
        const png = await page.screenshot({
          clip: {
            x: Math.round(clip.x),
            y: Math.round(clip.y),
            width: Math.round(clip.w) - (Math.round(clip.w) % 2),
            height: Math.round(clip.h) - (Math.round(clip.h) % 2),
          },
          type: 'jpeg',
          quality: 62,
          animations: 'allow',
        });
        writeFileSync(join(TMP, `f${String(i).padStart(4, '0')}.jpg`), png);
        i++;
      } catch {
        break;
      }
    }
    return i / ((Date.now() - t0) / 1000);
  };

  const grabando = capturar();
  await sleep(700);
  // Entrada con recorrido, no de un salto.
  await page.mouse.move(centro.x - 320, centro.y + 140);
  await page.mouse.move(centro.x - 200, centro.y + 60, { steps: 10 });
  await page.mouse.move(centro.x - 60, centro.y + 10, { steps: 12 });
  await page.mouse.move(centro.x, centro.y, { steps: 10 });
  await sleep(2200);
  // Y una salida, para ver si el efecto se deshace o se queda.
  await page.mouse.move(centro.x + 380, centro.y - 160, { steps: 14 });
  const fps = await grabando;

  await ctx.close();
  await browser.close();

  rafagaAMp4(TMP, join(OUT, `hover-${titulo}.mp4`), fps, 900);
  writeFileSync(
    join(OUT, 'hover.txt'),
    [
      `objetivo: ${titulo}`,
      `caja: ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`,
      `recorte: ${Math.round(clip.x)},${Math.round(clip.y)} ${Math.round(clip.w)}x${Math.round(clip.h)}`,
      `${i} capturas a ${fps.toFixed(1)} fps · reloj ×${LENTO} lento`,
      `o sea ~${(fps * LENTO).toFixed(0)} fps efectivos sobre el tiempo real del efecto`,
    ].join('\n'),
    'utf8',
  );
  console.log(`   ${i} capturas a ${fps.toFixed(1)} fps (reloj ×${LENTO} lento)`);
  console.log(`\nVídeo en ${join(OUT, `hover-${titulo}.mp4`)}`);
} catch (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
} finally {
  if (preview) preview.stop();
  process.exit(process.exitCode ?? 0);
}
