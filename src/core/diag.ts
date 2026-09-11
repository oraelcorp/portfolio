// src/core/diag.ts — panel de diagnóstico que corre EN EL TELÉFONO. Se activa con `?diag`.
//
// Por qué existe: el retrato no aparece en el iPhone de Javier y desde aquí no hay forma de
// mirar dentro de ESE teléfono — Safari Web Inspector remoto necesita un Mac con el móvil
// enchufado. Todas mis mediciones han salido de emuladores de escritorio, y por eso di por
// arreglado algo que en su móvil sigue roto. Esto lo sustituye: enseña en la propia pantalla el
// estado real del <video>, del canvas y de la consola, para que una captura valga como prueba.
//
// Lo que contesta, en este orden (que es el orden en que se puede romper):
//   1. ¿Está el teléfono viendo el build con el arreglo, o un `index.html` cacheado?
//   2. ¿Hay WebGL2, o se cayó al fallback de Canvas 2D?
//   3. ¿Está el <video> EN el DOM, y con qué estilo calculado? (el arreglo depende de eso)
//   4. ¿Ha cargado y está reproduciéndose, o `play()` fue rechazado?
//   5. ¿Llega tinta al canvas? — que es lo único que decide si se ve o no se ve.

import type { Module } from './utils.ts';

const CSS = `
position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:70vh;overflow:auto;
background:#000;color:#0f0;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
padding:8px 10px;border-top:2px solid #0f0;white-space:pre-wrap;word-break:break-word;
-webkit-user-select:text;user-select:text`;

/** Tinta del canvas, submuestreada: en un teléfono no hace falta leer 700x797 enteros. */
function tinta(c: HTMLCanvasElement | null): number {
  if (!c || !c.width) return -1;
  try {
    const off = document.createElement('canvas');
    off.width = 100;
    off.height = Math.max(1, Math.round((c.height / c.width) * 100));
    const x = off.getContext('2d');
    if (!x) return -1;
    x.drawImage(c, 0, 0, off.width, off.height);
    const d = x.getImageData(0, 0, off.width, off.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0) >= 26) n++;
    }
    return n;
  } catch {
    return -2; // el canvas no se dejó leer (contexto perdido, o el navegador lo bloqueó)
  }
}

function informe(): string {
  const c = document.querySelector<HTMLCanvasElement>('[data-ascii]');
  const v = document.querySelector<HTMLVideoElement>('video');
  const build =
    document.querySelector<HTMLMetaElement>('meta[name="javier:build"]')?.content ?? '(sin sello)';
  const errores = ((window as unknown as { __errores?: string[] }).__errores ?? []).slice(-6);

  const L: string[] = [];
  const linea = (k: string, val: string | number | boolean | null | undefined): void => {
    L.push(`${k.padEnd(9)} ${String(val)}`);
  };

  const t = tinta(c);
  L.push(t > 200 ? '### RETRATO CON TINTA ###' : '### RETRATO VACIO ###');
  linea('TINTA', `${t}  (>200 = se ve algo)`);
  L.push('');
  linea('BUILD', build);
  linea('PANTALLA', `${window.innerWidth}x${window.innerHeight} dpr ${window.devicePixelRatio}`);
  linea('REDUCIDO', window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  linea('UA', navigator.userAgent);
  L.push('');

  // --- motor -------------------------------------------------------------------------
  let webgl2: string;
  try {
    webgl2 = document.createElement('canvas').getContext('webgl2') ? 'sí' : 'NO (fallback 2D)';
  } catch {
    webgl2 = 'excepción al pedirlo';
  }
  linea('WEBGL2', webgl2);
  linea('MOTOR', c?.dataset.glReady ? 'WebGL2' : c?.dataset.reveal !== undefined ? 'Canvas 2D' : '¿ninguno?');
  linea(
    'CANVAS',
    c
      ? `${c.width}x${c.height} · css ${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`
      : 'NO EXISTE',
  );
  linea(
    'GL',
    c
      ? `ready=${c.dataset.glReady ?? '-'} reveal=${c.dataset.glReveal ?? '-'} grid=${c.dataset.glGrid ?? '-'} seq=${c.dataset.glSeq ?? '-'} ms=${c.dataset.glMs ?? '-'}`
      : '-',
  );
  L.push('');

  // --- el <video>, que es donde estaba la causa raíz -----------------------------------
  if (!v) {
    linea('VIDEO', 'NO HAY <video> EN EL DOM  <-- el arreglo no ha llegado a este teléfono');
  } else {
    const cs = getComputedStyle(v);
    const r = v.getBoundingClientRect();
    linea('VIDEO', `conectado=${v.isConnected} rs=${v.readyState} net=${v.networkState} paused=${v.paused}`);
    linea(
      '',
      `t=${v.currentTime.toFixed(2)} intrinseco=${v.videoWidth}x${v.videoHeight} err=${v.error?.code ?? '-'}`,
    );
    // Esto es lo que no puedo ver desde fuera: cómo compone iOS ese elemento DE VERDAD.
    linea('V.ESTILO', `display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity}`);
    linea(
      '',
      `caja=${Math.round(r.width)}x${Math.round(r.height)} en (${Math.round(r.left)},${Math.round(r.top)})`,
    );
    linea(
      'V.ATTR',
      `muted=${v.muted} playsinline=${v.hasAttribute('playsinline')} webkit=${v.hasAttribute('webkit-playsinline')}`,
    );
    const gl = (window as unknown as { __asciiGL?: { playError?: string } }).__asciiGL;
    linea('PLAY()', gl?.playError ?? '(sin error)');
  }
  L.push('');
  // Bug 2, comprobable a ojo en el propio teléfono: se abre el menú, se toca un enlace y se
  // mira si `y` cambia. `lenis-stopped` es la clase que Lenis pone en <html> mientras está
  // parado — que era justo la causa: con Lenis parado descartaba el scrollTo.
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  linea(
    'SCROLL',
    `y=${Math.round(window.scrollY)} lenis=${document.documentElement.className.includes('lenis-stopped') ? 'PARADO' : 'en marcha'} menu=${menu?.dataset.open === 'true' ? 'abierto' : 'cerrado'}`,
  );

  L.push('');
  linea('ERRORES', errores.length);
  for (const e of errores) L.push(`  ${e}`);
  return L.join('\n');
}

export function initDiag(): Module {
  if (!new URLSearchParams(window.location.search).has('diag')) return { destroy() {} };

  const caja = document.createElement('div');
  caja.style.cssText = CSS;
  const cuerpo = document.createElement('div');
  const barra = document.createElement('div');
  barra.style.cssText = 'display:flex;gap:8px;margin-bottom:6px';

  const boton = (texto: string, alPulsar: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = texto;
    b.style.cssText =
      'flex:1;background:#0f0;color:#000;border:0;padding:9px 6px;font:bold 11px ui-monospace,monospace';
    b.addEventListener('click', alPulsar);
    return b;
  };

  // Reintentar `play()` con un gesto real: es la única forma de distinguir "la política de
  // autoplay lo bloquea" de "no dibuja pase lo que pase", y en un emulador no se puede probar.
  barra.append(
    boton('REINTENTAR PLAY', () => {
      const v = document.querySelector('video');
      void v?.play().catch((e: Error) => {
        (window as unknown as { __errores?: string[] }).__errores?.push(`play manual: ${e.name}`);
      });
    }),
    boton('COPIAR', () => {
      void navigator.clipboard?.writeText(informe()).catch(() => {});
    }),
    boton('OCULTAR', () => caja.remove()),
  );

  caja.append(barra, cuerpo);
  document.body.appendChild(caja);

  const pintar = (): void => {
    cuerpo.textContent = informe();
  };
  pintar();
  const id = window.setInterval(pintar, 700);

  return {
    destroy() {
      window.clearInterval(id);
      caja.remove();
    },
  };
}
