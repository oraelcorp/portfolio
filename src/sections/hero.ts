// src/sections/hero.ts — monta el retrato ASCII del hero y el del footer. Fase 3, migrado a
// WebGL2 en la Fase 8 (2026-09-08).
//
// El motor por defecto es WebGL2 con el vídeo. La razón NO es el rendimiento: el Canvas 2D con
// foto fija ya cabía en el presupuesto de §8. Es que el sujeto pasa a ser vídeo, y re-muestrear
// vídeo a 30 fps cuesta ~37 ms por frame en CPU contra 0.40 ms en GPU — dos órdenes de magnitud
// que ninguna optimización cierra. Medido en `scripts/compare-perf.ts`.
//
// El Canvas 2D se conserva como FALLBACK y se carga con `import()` dinámico: así quien tiene
// WebGL2 no descarga sus bytes, y quien no lo tiene sigue viendo un retrato en vez de un hueco.
// También se puede forzar con `?2d`, que es como lo sigue verificando `check-phase3`.

import { AsciiPortraitGL } from '../effects/ascii/AsciiPortraitGL.ts';
import { site } from '../content/site.ts';
import type { Module } from '../core/utils.ts';

const SRC = '/img/portrait/portrait.png';
/** Fuente del hero: el clip ya reencuadrado y con el loop disuelto (`scripts/prep-video.ts`). */
const SRC_VIDEO = '/img/portrait/jaguar-loop.mp4';

/** `?2d` fuerza el fallback de Canvas 2D, para poder verificarlo aunque no sea el camino vivo. */
function forzarCanvas2D(): boolean {
  return new URLSearchParams(window.location.search).has('2d');
}

/**
 * Cablea el botón de modo color y devuelve el avisador que sincroniza rótulo y `aria-pressed`.
 * Lo comparten los dos motores: al migrar, la rama WebGL no lo tenía y eso habría perdido el
 * acceso por teclado que exige §8 y que comprueba la suite.
 */
function conectarToggle(
  toggle: HTMLButtonElement | null,
  portrait: { toggleMode: () => void },
  modules: Module[],
): (mode: 'ascii' | 'color') => void {
  if (toggle) {
    const onClick = (): void => portrait.toggleMode();
    toggle.addEventListener('click', onClick);
    modules.push({
      destroy() {
        toggle.removeEventListener('click', onClick);
      },
    });
  }
  return (mode) => {
    if (!toggle) return;
    toggle.textContent = mode === 'color' ? site.hero.asciiHintBack : site.hero.asciiHint;
    // Es un interruptor de dos estados: el rótulo cambia para quien lo ve y `aria-pressed` lo
    // dice para quien no. Sin él, el estado solo se deducía de un texto que además es una
    // instrucción ("click to reveal"), no un estado.
    toggle.setAttribute('aria-pressed', mode === 'color' ? 'true' : 'false');
  };
}

/** Camino de respaldo: Canvas 2D con la foto. Se importa solo si hace falta. */
async function montarCanvas2D(
  heroCanvas: HTMLCanvasElement | null,
  footerCanvas: HTMLCanvasElement | null,
  ready: Promise<void>,
  modules: Module[],
): Promise<void> {
  const [{ AsciiPortrait }, { initAsciiDebug }] = await Promise.all([
    import('../effects/ascii/AsciiPortrait.ts'),
    import('../effects/ascii/debug.ts'),
  ]);

  if (heroCanvas) {
    const toggle = document.querySelector<HTMLButtonElement>('[data-ascii-toggle]');
    let avisar: (mode: 'ascii' | 'color') => void = () => {};
    const portrait = new AsciiPortrait(heroCanvas, {
      src: SRC,
      interactive: true,
      onModeChange: (mode) => avisar(mode),
    });
    avisar = conectarToggle(toggle, portrait, modules);
    modules.push(portrait, initAsciiDebug(portrait));
    void ready.then(() => portrait.reveal());
  }

  if (footerCanvas) {
    modules.push(new AsciiPortrait(footerCanvas, { src: SRC, interactive: false, cellW: 7, cellH: 10 }));
  }
}

/** `ready` es la salida del preloader: la onda de entrada arranca ahí (§6.3 punto 9). */
export function initAscii(ready: Promise<void>): Module {
  const modules: Module[] = [];
  const heroCanvas = document.querySelector<HTMLCanvasElement>('[data-ascii]');
  const footerCanvas = document.querySelector<HTMLCanvasElement>('[data-ascii-footer]');
  const salida: Module = {
    destroy() {
      for (const m of modules) m.destroy();
    },
  };

  if (forzarCanvas2D()) {
    void montarCanvas2D(heroCanvas, footerCanvas, ready, modules);
    return salida;
  }

  try {
    const q = new URLSearchParams(window.location.search);
    const pal = q.get('glpal');
    const num = (clave: string, porDefecto: number): number => {
      const v = Number(q.get(clave));
      return Number.isFinite(v) && v > 0 ? v : porDefecto;
    };

    /**
     * Igual que `num`, pero el CERO es un valor válido y no el "no está".
     *
     * Hace falta porque en dos knobs el 0 significa algo: `glhocicon=0` es el soporte 3x3 y
     * `glposter=0` es el gradiente continuo. Con `num` los dos caían al default sin decirlo, y
     * eso CONTAMINÓ una comparativa: la fila "3x3 (antes)" de `measure-hocico-comps` estaba
     * midiendo el default, así que salía idéntica a la fila del default y parecía un hallazgo.
     */
    const num0 = (clave: string, porDefecto: number): number => {
      const v = Number(q.get(clave));
      return q.get(clave) !== null && Number.isFinite(v) && v >= 0 ? v : porDefecto;
    };

    if (heroCanvas) {
      const toggle = document.querySelector<HTMLButtonElement>('[data-ascii-toggle]');
      let avisar: (mode: 'ascii' | 'color') => void = () => {};
      const portrait = new AsciiPortraitGL(heroCanvas, {
        // `?glphoto` usa la FOTO en vez del vídeo: sirve para comparar paridad con el 2D
        // usando el mismo material (scripts/check-gl-parity.ts).
        src: q.has('glphoto') ? SRC : SRC_VIDEO,
        // Por defecto, la RAMPA DE 11 TONOS de Javier (checkpoint B): sustituye tanto al RGB
        // literal de la foto como a las bandas derivadas de Otsu. Las otras siguen accesibles
        // por URL para poder comparar: `?glpal=poster|bands|ramp|photo`.
        palette: pal === 'photo' || pal === 'ramp' || pal === 'bands' || pal === 'rampa11' ? pal : 'poster',
        // `?glposter=5` posteriza la MISMA rampa en N escalones, para la comparativa.
        poster: num0('glposter', 5),
        // `?glsnap=0` vuelve a los N escalones uniformes de `glposter`. Por defecto se cuantiza
        // a las POSICIONES de la rampa: es la única variante donde los 11 colores pueden salir.
        snap: q.get('glsnap') !== '0',
        // `?glhlsolo=1` reserva el blanco del tope al brillo puntual; `?glhlbaja=` dice cuántos
        // escalones baja la estructura (1 = #BFBCB3, 2 = #978E7D, 3 = el crema #F2DB8E).
        // Pelaje dorado por región: `?glpelaje=0` lo apaga, `?glpelajeluma=`, `?glpelajen=`,
        // `?glpelajex0=` mueven el detector y `?glpelajei0=`/`?glpelajei1=` el tramo de rampa.
        pelaje: q.get('glpelaje') !== '0',
        pelajeLuma: num0('glpelajeluma', 0.6),
        pelajeSoporte: num0('glpelajen', 12),
        pelajeX0: num0('glpelajex0', 0.55),
        pelajeY0: num0('glpelajey0', 0.4),
        pelajeI0: num0('glpelajei0', 4),
        pelajeI1: num0('glpelajei1', 6),
        // Perturbación del frente de las dos ondas: `?glondaruido=` amplitud en celdas,
        // `?glondaescala=` tamaño de lóbulo, `?glondatono=` adelanto por zonas claras,
        // `?glondaease=` 2 = power1.out, 3 = cubic.out.
        ondaRuido: num0('glondaruido', 6),
        ondaEscala: num0('glondaescala', 14),
        ondaTono: num0('glondatono', 0),
        ondaEase: num0('glondaease', 2),
        hlSolo: q.get('glhlsolo') !== '0',
        hlBaja: num('glhlbaja', 1),
        // `?glhl=0` pliega el highlight al gradiente · 1 = capa blanca (por defecto) · 2 = capa
        // con el neutro alto de la propia rampa.
        hlModo: q.get('glhl') === '0' ? 0 : q.get('glhl') === '1' ? 1 : 2,
        // `?glfrio=0` vuelve al neutro cálido en la franja más alta.
        frio: q.get('glfrio') !== '0',
        // `?glfriot=0.92` mueve el umbral del frío. Suelto de la posterización a propósito.
        frioMin: num('glfriomin', 0.62),
        frioMax: num('glfriomax', 0.78),
        frioY0: num('glfrioy0', 0.34),
        frioY1: num('glfrioy1', 0.54),
        // `?glfriohl=0` extiende el frío a toda la franja alta, no solo a los highlights.
        // `?glfriozona=0` extiende el frío a toda la banda de luminancia, sin acotar la región.
        frioZona: q.get('glfriozona') !== '0',
        // `?glhocico=0` pliega el acento del hocico al gradiente, por su luminancia real.
        hocico: q.get('glhocico') !== '0',
        // `?glhocicon=0` vuelve al soporte 3x3; 8/12/16 barren el 5x5.
        hocicoSoporte: num0('glhocicon', 20),
        // `?glmix=1` fuerza el color sin clic; sin él se empieza en ASCII, como en producción.
        colorMix: q.has('glmix') ? Number(q.get('glmix') ?? 1) : 0,
        // `?glbleed=0` apaga la sangría, para comparar el puntero con y sin ella.
        bleed: q.get('glbleed') !== '0',
        // `?glwave=4` alarga la onda del clic: a 0.9 s cuesta ver el frente a ojo.
        waveSeconds: num('glwave', 0.9),
        zoom: num('glzoom', 1.2),
        // `?glatlas=nearest` cambia el filtro del atlas, para medir si el bilineal difumina.
        atlasFilter: q.get('glatlas') === 'nearest' ? 'nearest' : 'linear',
        // `?glexpo=0` apaga la normalización de exposición (el estado anterior al checkpoint A).
        exposure: q.get('glexpo') !== '0',
        // CANDADO: bajo automatización el hover nace apagado y solo lo enciende el helper de
        // sondas (`scripts/lib/pointer.ts` -> `habilitarHover()`), o `?glhover=1` a mano. Cuatro
        // mediciones se contaminaron porque el puntero entraba sin querer y la sangría teñía el
        // retrato de color. Para una persona no cambia nada: `navigator.webdriver` es false.
        hover: !navigator.webdriver || q.has('glhover'),
        onModeChange: (mode) => avisar(mode),
      });
      avisar = conectarToggle(toggle, portrait, modules);
      modules.push(portrait);
      // `?glgain=1.5` fija la ganancia de exposición, para comparar el mismo frame a ojo.
      const gFijo = Number(q.get('glgain'));
      if (Number.isFinite(gFijo) && gFijo > 0) portrait.gainOverride = gFijo;
      (window as unknown as { __asciiGL?: AsciiPortraitGL }).__asciiGL = portrait;
      void ready.then(() => portrait.reveal());
    }

    if (footerCanvas) {
      // El footer va con la FOTO, no con el vídeo: es decorativo, no merece 1.3 MB ni una
      // pasada de muestreo por frame. `interactive: false` le quita puntero, clic y sangría.
      modules.push(
        new AsciiPortraitGL(footerCanvas, {
          src: SRC,
          interactive: false,
          cellW: 7,
          cellH: 10,
          zoom: 1,
          focus: { x: 0.5, y: 0.5 },
        }),
      );
    }
  } catch (e) {
    // Sin WebGL2 no hay retrato: se cae al Canvas 2D en vez de dejar el hero vacío.
    console.warn('WebGL2 no disponible, se usa el fallback de Canvas 2D:', e);
    for (const m of modules) m.destroy();
    modules.length = 0;
    void montarCanvas2D(heroCanvas, footerCanvas, ready, modules);
  }

  return salida;
}
