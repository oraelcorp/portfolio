// src/effects/ascii/AsciiPortraitGL.ts — retrato ASCII en WebGL2. Fase 8, checkpoint 2.1.
//
// Por qué existe: con foto fija el Canvas 2D va sobrado (medido: 14/14 en check-phase3 a celda
// 4.00, pintado p90 1.90 ms). Con VÍDEO no: `sample()` —blur, luminancia, highlights, glifos—
// cuesta 13.7 ms a esa celda, y con vídeo hay que rehacerlo a 30 fps. Eso rompe el presupuesto
// de 4 ms de §8 por sí solo, antes de pintar un solo glifo. Ese, y no la densidad, es el
// argumento real para la GPU.
//
// SIN Three.js (decisión aprobada, §3): el efecto es un quad a pantalla completa con un
// fragment shader. WebGL2 crudo lo hace sin sumar ~600 KB al bundle.
//
// Dos pasadas, que son el calco del pipeline de 2D:
//   1. LUMA  -> a un framebuffer de cols x rows (una texel por celda). Muestrea el vídeo con
//      un gaussiano, aplica la curva de contraste y guarda luminancia + RGB. Es el equivalente
//      de `sample()`, pero sin `getImageData` ni recorrer 36 450 celdas en JS.
//   2. GLIFO -> a pantalla. Por píxel: localiza su celda, lee la textura de luma, deduce el
//      highlight de sus 8 vecinas, elige banda y glifo, y muestrea el atlas.
//
// La pasada 1 corre a 30 fps como máximo (igual que el muestreo de 2D, §6.3 punto 2); la 2
// corre por frame, que es lo que mantiene vivos shimmer y reveal sin volver a muestrear.

import { BAND_COUNT, BAND_MAX, BAND_OFFSET, buildGlyphAtlas } from './glyphAtlas.ts';
import { EMPTY } from './charRamp.ts';
// La paleta NO se duplica: los cortes de Otsu y las anclas viven en `palette.ts`, que es donde
// están medidos. Aquí solo se normalizan a 0-1 para el shader.
import {
  ACENTO_HOCICO,
  ANCLAS,
  CORTES,
  FRIO_ALTO,
  HIGHLIGHT_NEUTRO,
  POSICIONES,
  POSTER_ESCALONES,
  RAMPA,
  type PaletteMode,
} from './palette.ts';
import type { Module } from '../../core/utils.ts';

export interface AsciiGLOptions {
  src: string;
  cellW?: number;
  cellH?: number;
  contrast?: number;
  smooth?: number;
  highlightDelta?: number;
  fontFamily?: string;
  revealOrigin?: { x: number; y: number };
  /** Zoom sobre el recorte `cover`. 1 = encuadre nativo del clip. Solo hacia dentro. */
  zoom?: number;
  /**
   * Punto focal del recorte, 0-1 en cada eje (0.5 = centrado, que es lo que hacía antes).
   * Hace falta en cuanto se aplica zoom: el recorte centrado se come los bigotes, que solo
   * tienen 16 px de margen en el frame donde más se extienden.
   */
  focus?: { x: number; y: number };
  /** Paleta del modo color (§6.3 punto 12 / Fase 8 parte 1; rampa de 11 tonos, checkpoint B). */
  palette?: PaletteMode;
  /** Escalones de la versión posterizada. 0 = gradiente continuo. */
  poster?: number;
  /**
   * Reservar el punto más alto de la rampa para el BRILLO PUNTUAL (contraste local alto) y
   * bajar la estructura que llega ahí solo por luminancia. Ver `SeparacionHighlight`.
   */
  hlSolo?: boolean;
  /** Escalones que baja esa estructura: 1 = #BFBCB3, 2 = #978E7D, 3 = el crema #F2DB8E. */
  hlBaja?: number;
  /**
   * Cuantizar a las POSICIONES de la rampa en vez de a `poster` escalones uniformes. Es la
   * única forma de que los 11 colores puedan salir: la rejilla uniforme no cae sobre los
   * puntos de la rampa (ver `colorSnap` en palette.ts).
   */
  snap?: boolean;
  /** 0 = highlight plegado al gradiente · 1 = capa blanca aparte · 2 = capa con el neutro alto. */
  hlModo?: 0 | 1 | 2;
  /** Si el hocico sigue siendo excepción de color o se pliega al gradiente. */
  hocico?: boolean;
  /** Vecinas mínimas (ventana 5x5) para contar como hocico. 0 = el 3x3 anterior. */
  hocicoSoporte?: number;
  /**
   * PELAJE DORADO POR REGIÓN (2026-09-10). Decisión de diseño explícita de Javier: en vez de
   * esperar que el dorado salga de la luminancia, se fuerza — el mismo enfoque que el acento
   * rojo del hocico, aplicado al cuerpo.
   */
  pelaje?: boolean;
  /** Luminancia desde la que una celda es candidata a pelaje. */
  pelajeLuma?: number;
  /** Vecinas mínimas en la ventana 5x5: es lo que exige SUPERFICIE y descarta manchas sueltas. */
  pelajeSoporte?: number;
  /** Acotado espacial, en fracción de rejilla. Sin esto se come la mandíbula (medido). */
  pelajeX0?: number;
  pelajeY0?: number;
  /** Tramo de la rampa al que se fuerza: índices, por defecto 4–6 (#98581A … #DFAC50). */
  pelajeI0?: number;
  pelajeI1?: number;
  /** Tono frío en la franja más alta en vez del neutro cálido (decisión de Javier). */
  frio?: boolean;
  /** Banda de luminancia del frío. Medida sobre la coronilla real: 0.63–0.77. */
  frioMin?: number;
  frioMax?: number;
  /** Acotar además EN ESPACIO a la franja vertical de la coronilla (es una región, no una banda). */
  frioZona?: boolean;
  frioY0?: number;
  frioY1?: number;
  /**
   * PERTURBACIÓN DEL FRENTE (2026-09-10). Amplitud en CELDAS del ruido que se le suma a la
   * distancia al origen, para que el borde de la onda deje de ser un círculo perfecto.
   * 0 = el círculo de antes. Afecta a la onda del clic Y al reveal de entrada: comparten
   * mecanismo, así que se evalúan juntos.
   */
  ondaRuido?: number;
  /** Tamaño de los lóbulos del ruido, en celdas. Grande = ondulación amplia; pequeño = desgarro. */
  ondaEscala?: number;
  /** Cuánto adelanta el frente en las zonas claras del retrato, en celdas. 0 = nada. */
  ondaTono?: number;
  /** Exponente del ease de las dos ondas: 2 = `power1.out` (lo de antes), 3 = `cubic.out`. */
  ondaEase?: number;
  /** 0 = ASCII acento/blanco · 1 = color pleno. La onda del clic lo controla por celda. */
  colorMix?: number;
  /** Sangría de color por hover (§6.3 punto 13). Se puede apagar para comparar en vivo. */
  bleed?: boolean;
  /**
   * Si el retrato reacciona al puntero. Es el CANDADO del 2026-09-09: bajo automatización se
   * pone a `false`, así que una sonda no puede teñir el retrato sin querer. Ver `hero.ts`.
   */
  hover?: boolean;
  /** Duración de la onda de color del clic, en segundos. */
  waveSeconds?: number;
  /**
   * Puntero, clic y sangría. `false` para la instancia del footer, que es decorativa: sin
   * esto pagaría la pasada de sangría por frame para un retrato con el que nadie interactúa.
   */
  interactive?: boolean;
  /** Avisa del cambio ascii<->color, para sincronizar el rótulo y `aria-pressed` (§8). */
  onModeChange?: (mode: 'ascii' | 'color') => void;
  /**
   * Filtro de la textura del atlas de glifos. Existe para poder MEDIR la sospecha de que el
   * bilineal difumina los caracteres (checkpoint A) en vez de discutirla: `?glatlas=nearest`.
   * Sobre el papel da igual —el muestreo cae en centros de téxel— pero eso hay que comprobarlo.
   */
  atlasFilter?: 'linear' | 'nearest';
  /**
   * Normalización de exposición por frame. `false` deja el vídeo tal cual venía, que es como
   * estaba antes del checkpoint A: sirve para capturar el «antes» sin volver a compilar.
   */
  exposure?: boolean;
}

const ALPHA_FLOOR = 0.22;
const ALPHA_RANGE = 0.5;
const SHIMMER_MS = 120;
const SHIMMER_RATE = 0.03;
const WAVE_BAND = 7;
/** Tope de muestreo, igual que en 2D: el vídeo va a 24 fps, no hace falta releerlo por frame. */
const SAMPLE_HZ = 30;

// Sangría de color (§6.3 punto 13). Mismos valores que el Canvas 2D: están medidos allí.
const BLEED_CELLS = 26;
const BLEED_EDGE = 1.4;
const BLEED_TONE = 3.2;
const BLEED_RISE = 3.4;
const BLEED_FALL = 4.5;
/** Empuje de luminancia del puntero y radio, §6.3 punto 8. */
const POINTER_LIFT = 0.18;
const POINTER_RADIUS = 6;
/** Duración de la onda de color del clic. §6.3 punto 12 pedía ~0.9 s. */
const COLOR_WAVE_S = 0.9;
/** Grosor del frente de la onda de color, en celdas. */
const COLOR_BAND = 9;

const QUAD_VS = `#version 300 es
// Un triángulo que cubre la pantalla: más barato que dos y sin costura en la diagonal.
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Pasada 1 — una texel por celda: luminancia con contraste en .a, color de la foto en .rgb. */
const LUMA_FS = `#version 300 es
precision highp float;

uniform sampler2D u_video;
uniform vec2 u_grid;        // cols, rows
uniform vec4 u_srcRect;     // x, y, w, h en UV del vídeo (recorte cover + zoom)
uniform float u_contrast;
uniform float u_sigma;      // desviación del gaussiano, EN CELDAS
// Ganancia de exposicion del frame. Con foto vale 1 y no hace nada; con VIDEO compensa que el
// clip se oscurece y se aclara a lo largo del loop. Medido en diag-celdas-video.ts: sin esto
// las celdas con tinta oscilan entre 5 844 y 10 807 (x1.85) mientras la foto rinde 10 450
// constantes, y el retrato se vacia justo en los tramos oscuros. Ver calcularGanancia().
// (Sin acentos graves aqui dentro: un backtick cierra el template literal del shader.)
uniform float u_gain;

out vec4 outColor;

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  // Centro de la celda en UV del vídeo
  vec2 uvStep = u_srcRect.zw / u_grid;

  // El 2D hace DOS etapas: difumina a 2x la rejilla y luego baja a 1x promediando 2x2.
  // La primera version de esto las fundia en una sola gaussiana con las sigmas sumadas en
  // cuadratura, y MEDIDO en check-gl-palette dejaba ~1000 celdas (10 %) corridas una banda
  // hacia abajo, casi todas de ambar a cobre. Se emulan las dos etapas por separado: cuatro
  // sub-muestras en las posiciones de la rejilla 2x, cada una con el blur de smooth/2 celdas
  // (que es lo que vale smooth px medido sobre una rejilla del doble de resolucion), y la
  // media de las cuatro hace de bajada a 1x.
  float sg = max(u_sigma, 1e-4);
  vec3 rgb = vec3(0.0);
  for (int sy = 0; sy < 2; sy++) {
    for (int sx = 0; sx < 2; sx++) {
      vec2 sub = vec2(float(sx), float(sy)) * 0.5 - 0.25;  // -0.25 / +0.25 de celda
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int j = -2; j <= 2; j++) {
        for (int i = -2; i <= 2; i++) {
          vec2 off = vec2(float(i), float(j)) * sg;
          float w = exp(-0.5 * float(i * i + j * j));
          vec2 uv = u_srcRect.xy + (cell + 0.5 + sub + off) * uvStep;
          acc += texture(u_video, uv).rgb * w;
          wsum += w;
        }
      }
      rgb += acc / max(wsum, 1e-6);
    }
  }
  rgb *= 0.25;

  float l = clamp(dot(rgb, vec3(0.2126, 0.7152, 0.0722)) * u_gain, 0.0, 1.0);
  float adjusted = clamp((l - 0.15) * u_contrast, 0.0, 1.0);

  // Mismo reescalado que en 2D: se conserva el tono pero la intensidad va a la curva del ASCII.
  float k = clamp(adjusted / max(l, 0.02), 0.0, 2.6);
  outColor = vec4(rgb * k, adjusted);
}`;

/**
 * Pasada de SANGRÍA (§6.3 punto 13). Es un autómata celular sobre la rejilla: cada celda mira
 * su estado anterior y el de sus 4 vecinas. En CPU eso obligaba a recorrer una caja acotada
 * alrededor del puntero para no salirse del presupuesto; en GPU el grid entero cuesta lo mismo
 * que la caja, así que se evalúa completo con ping-pong entre dos texturas.
 *
 * La REGLA es la del Canvas 2D, no una reinterpretación: conectividad BINARIA (basta tocar una
 * celda ya teñida) por tolerancia tonal respecto a la celda semilla, freno en el salto local y
 * caída lineal con la distancia. El modelo multiplicativo clásico ya se descartó midiendo — en
 * pelaje el contraste entre vecinas es 0.3-0.6 y el derrame moría a 3-4 celdas.
 */
const BLEED_FS = `#version 300 es
precision highp float;

uniform sampler2D u_luma;
uniform sampler2D u_prev;
uniform vec2 u_grid;
uniform vec2 u_pointer;   // en celdas; x < -100 = sin puntero
uniform float u_dt;
uniform float u_tone;     // dureza de la tolerancia tonal
uniform float u_edge;     // dureza del freno en el salto local

out vec4 outColor;

float lumaAt(vec2 c) {
  return texture(u_luma, (clamp(c, vec2(0.0), u_grid - 1.0) + 0.5) / u_grid).a;
}
float bleedAt(vec2 c) {
  return texture(u_prev, (clamp(c, vec2(0.0), u_grid - 1.0) + 0.5) / u_grid).r;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float cur = bleedAt(cell);
  bool on = u_pointer.x > -100.0;

  float objetivo = 0.0;
  bool conserva = false;

  if (on) {
    float d = distance(cell, u_pointer);
    if (d <= 1.5) {
      objetivo = 1.0;   // la celda bajo el cursor es la fuente
    } else if (d > ${BLEED_CELLS}.0) {
      // FUERA del alcance del puntero: la celda CONSERVA su valor, no decae.
      //
      // Esto no es un detalle: en el Canvas 2D el bucle solo recorre una caja acotada
      // alrededor del cursor, así que lo que queda fuera sencillamente no se actualiza y
      // mantiene lo que tuviera. Esa caja se puso por COSTE, pero resulta ser LOAD-BEARING
      // para el efecto: al mover el ratón, las celdas que van quedando atrás se congelan y
      // el derrame acumula una estela irregular.
      //
      // Al portarlo a GPU evalué la rejilla entera "porque cuesta lo mismo", y con eso las
      // celdas de fuera pasaban a decaer a 0: el efecto se quedaba en un disco pegado al
      // cursor. Medido: 1035 celdas y 14 % de irregularidad frente a las 3089 y 48 % del 2D.
      conserva = true;
    } else if (d <= ${BLEED_CELLS}.0) {
      float l = lumaAt(cell);
      // El tono de referencia se lee aquí mismo: no hace falta traerse la luminancia a la CPU
      // solo para calcular la semilla.
      float seed = lumaAt(floor(u_pointer + 0.5));
      float tono = exp(-u_tone * abs(l - seed));

      float conectado = 0.0;
      float salto = 1.0;
      vec2 vecinas[4];
      vecinas[0] = vec2(-1.0, 0.0);
      vecinas[1] = vec2(1.0, 0.0);
      vecinas[2] = vec2(0.0, -1.0);
      vecinas[3] = vec2(0.0, 1.0);
      for (int k = 0; k < 4; k++) {
        vec2 n = cell + vecinas[k];
        if (n.x < 0.0 || n.y < 0.0 || n.x >= u_grid.x || n.y >= u_grid.y) continue;
        if (bleedAt(n) > 0.06) {
          conectado = 1.0;
          salto = min(salto, abs(l - lumaAt(n)));
        }
      }

      if (conectado == 0.0) {
        // El 2D hace \`continue\` aquí y la celda conserva su valor. Se replica el efecto
        // visible; la diferencia es que allí conservaba el del buffer de dos frames atrás,
        // un detalle del doble búfer que no vale la pena reproducir.
        conserva = true;
      } else {
        float borde = exp(-u_edge * salto);
        objetivo = tono * borde * (1.0 - d / ${BLEED_CELLS}.0);
      }
    }
  }

  float next;
  if (conserva) {
    next = cur;
  } else {
    float rise = 1.0 - exp(-${BLEED_RISE} * u_dt);
    float fall = 1.0 - exp(-${BLEED_FALL} * u_dt);
    next = cur + (objetivo - cur) * (objetivo > cur ? rise : fall);
    // El repliegue es exponencial y no llega a 0 solo: se corta el rabo.
    if (next < 0.02 && objetivo == 0.0) next = 0.0;
  }

  outColor = vec4(next, 0.0, 0.0, 1.0);
}`;

/** Pasada 3 — el retrato. */
const GLYPH_FS = `#version 300 es
precision highp float;

uniform sampler2D u_luma;    // cols x rows
uniform sampler2D u_atlas;
uniform vec2 u_grid;         // cols, rows
uniform vec2 u_cellPx;       // tamaño de celda en px de dispositivo
uniform vec2 u_atlasGrid;    // baldosas del atlas: cols, rows
uniform float u_bandMax[10];
uniform float u_bandOff[10];
uniform float u_bandCnt[10];
uniform vec3 u_accent;
uniform vec3 u_fg;
uniform float u_hlDelta;
uniform float u_empty;
uniform float u_epoch;       // ventana de shimmer (cambia cada 120 ms)
uniform float u_revealR;     // radio de la onda de entrada, en celdas
uniform vec2 u_revealO;      // origen de la onda, en celdas
uniform vec2 u_viewport;

// --- Paleta (checkpoint 2.2). 0 = photo (tono real), 1 = bands, 2 = ramp.
uniform int u_palette;
uniform float u_colorMix;    // 0 = ASCII acento/blanco · 1 = color pleno
uniform float u_cortes[3];   // cortes de Otsu MEDIDOS (palette.ts)
uniform vec3 u_anclas[4];    // una ancla por banda, normalizada 0-1
uniform vec3 u_hocico;       // acento de región: interior del hocico
// Vecinas minimas para que una celda cuente como hocico. 0 = el 3x3 de antes.
uniform float u_hocicoN;
// Rampa de 11 tonos de Javier (checkpoint B). Fuente unica: palette.ts.
uniform vec3 u_rampa[11];
// Posicion de cada punto en t. NO son intervalos iguales: la familia neutra empieza en 0.90.
uniform float u_pos[11];
// Color del highlight cuando pertenece a la paleta (u_hlModo == 2).
uniform vec3 u_hlNeutro;
// Luminancia a partir de la cual manda el tono FRIO. 2.0 = nunca. Va SUELTO de la
// posterizacion a proposito: atado al escalon superior, el frio se llevaba el 50 % de la tinta
// pintada (medido) porque las celdas brillantes usan los glifos mas densos. Con umbral propio
// se puede graduar hasta que sea un toque y no el color del animal.
uniform float u_frioMin;
uniform float u_frioMax;
uniform vec3 u_frio;
// 1 = ademas acotado en espacio (la coronilla); 0 = en toda la banda de luminancia.
uniform float u_frioZona;
uniform float u_frioY0;
uniform float u_frioY1;
// 0 = gradiente continuo · N>1 = la misma rampa posterizada en N escalones
uniform float u_poster;
// 1 = cuantizar a las POSICIONES de la rampa (11 colores planos) en vez de a N escalones
uniform float u_snap;
// 1 = el punto mas alto de la rampa se reserva al BRILLO PUNTUAL; la estructura que llega ahi
// solo por luminancia baja u_hlBaja escalones. Medido en measure-mandibula.ts: en la mandibula,
// 503 celdas tocan el tope y solo 71 son highlight de verdad.
uniform float u_hlSolo;
uniform float u_hlBaja;
// PELAJE DORADO POR REGION: 1 = activo. Umbral de luminancia, soporte 5x5, acotado espacial y
// tramo de la rampa al que se fuerza.
uniform float u_pelajeOn;
uniform float u_pelajeLuma;
uniform float u_pelajeN;
uniform float u_pelajeX0;
uniform float u_pelajeY0;
uniform float u_pelajeI0;
uniform float u_pelajeI1;
// PERTURBACION DEL FRENTE: amplitud en celdas, tamano de lobulo y acoplamiento al tono.
uniform float u_ondaAmp;
uniform float u_ondaEscala;
uniform float u_ondaTono;
// 0 = el highlight se pliega al gradiente · 1 = capa aparte en --fg blanco (lo de antes)
// 2 = capa aparte con el neutro alto de la RAMPA, para que pertenezca a la paleta
uniform float u_hlModo;
// 1 = el hocico sigue siendo excepcion de color · 0 = se pliega al gradiente por su luminancia
uniform float u_hocicoOn;

// --- Puntero y onda de color (checkpoint 2.3)
uniform sampler2D u_bleed;
uniform vec2 u_pointer;      // en celdas; x < -100 = sin puntero
uniform float u_pointerR;    // radio del puntero, en celdas
uniform vec2 u_colorO;       // origen de la onda de color, en celdas
uniform float u_colorR;      // radio alcanzado por la onda, en celdas
uniform float u_colorTarget; // 1 = la onda pinta color · 0 = la onda devuelve a ASCII
uniform float u_colorBase;   // estado FUERA del frente: el modo de antes del clic
uniform float u_time;

out vec4 outColor;

// Calco del hash de charRamp.ts (seededIndex). En JS se hace con Math.imul sobre int32 con
// signo y aquí sobre uint, así que para una misma celda puede salir OTRO glifo DE LA MISMA
// BANDA. Es irrelevante para la paridad visual —la banda es la que fija la densidad— y no
// vale la pena replicar la aritmética con signo de JS para elegir entre 3 o 4 glifos iguales.
uint hash(uint seed) {
  uint h = seed * 2654435761u;
  h ^= h >> 15;
  h *= 2246822507u;
  h ^= h >> 13;
  return h;
}

// Ruido de valor coherente sobre la rejilla. Coherente y no aleatorio por celda a proposito:
// un ruido blanco convierte el borde en niebla de puntos; este lo deja como un borde ROTO, que
// es lo que se pidio. Se apoya en el mismo hash de arriba, asi que no entra nada nuevo.
float hash21(vec2 p) {
  uvec2 q = uvec2(ivec2(p) + 4096);
  return float(hash(q.x * 73856093u ^ hash(q.y * 19349663u)) & 0xFFFFFFu) / 16777215.0;
}

float ruidoValor(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float e = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, e, u.x), u.y);
}

/**
 * Cuanto se adelanta o se retrasa el frente en ESTA celda, en celdas.
 *
 * Dos octavas: la grande hace la ondulacion general y la pequena el desgarro del borde. Y un
 * termino opcional atado al TONO del retrato, para que la onda corra por las zonas claras y se
 * frene en las sombras — que es lo que hace que parezca que recorre el animal y no el lienzo.
 */
float perturbaFrente(vec2 cell, float l) {
  float p = 0.0;
  if (u_ondaAmp > 0.0) {
    float n1 = ruidoValor(cell / u_ondaEscala) * 2.0 - 1.0;
    float n2 = ruidoValor(cell / (u_ondaEscala * 0.45) + 31.7) * 2.0 - 1.0;
    p += u_ondaAmp * (n1 * 0.72 + n2 * 0.28);
  }
  if (u_ondaTono > 0.0) p -= u_ondaTono * (l - 0.5) * 2.0;
  return p;
}

vec4 texel(vec2 cell) {
  vec2 c = clamp(cell, vec2(0.0), u_grid - 1.0);
  return texture(u_luma, (c + 0.5) / u_grid);
}

float lumaAt(vec2 cell) { return texel(cell).a; }

int bandaDe(float l) {
  if (l < u_cortes[0]) return 0;
  if (l < u_cortes[1]) return 1;
  if (l < u_cortes[2]) return 2;
  return 3;
}

// Calco de colorDe() de palette.ts: plano por banda, o interpolado hacia la ancla siguiente.
vec3 colorDe(int modo, float l) {
  int b = bandaDe(l);
  if (modo == 1) return u_anclas[b];
  float lo = (b == 0) ? u_empty : u_cortes[b - 1];
  float hi = (b == 3) ? 1.0 : u_cortes[b];
  float t = (hi > lo) ? clamp((l - lo) / (hi - lo), 0.0, 1.0) : 0.0;
  return mix(u_anclas[b], u_anclas[min(3, b + 1)], t);
}

/**
 * Color de la rampa de 11 tonos. Los puntos se reparten a intervalos iguales en t, que es la
 * instruccion: es un gradiente, no bandas. Posterizar solo cuantiza la ENTRADA, asi que los
 * escalones caen sobre la misma rampa y no sobre otra paleta.
 */
vec3 colorRampa(float l, bool hi) {
  float x = clamp(l, 0.0, 1.0);
  // Snap a los PUNTOS de la rampa: sale uno de los 11 colores, sin mezcla. La rejilla uniforme
  // de u_poster no cae sobre las POSICIONES (no son equidistantes), asi que posterizando en N
  // escalones hay puntos de la rampa que no puede producir ninguna N.
  if (u_snap > 0.5) {
    int mejor = 0;
    float d = 2.0;
    for (int k = 0; k < 11; k++) {
      float dd = abs(x - u_pos[k]);
      if (dd < d) { d = dd; mejor = k; }
    }
    // El tope, solo para el brillo puntual: la estructura baja de escalon.
    if (u_hlSolo > 0.5 && !hi && mejor == 10) mejor = max(0, 10 - int(u_hlBaja));
    return u_rampa[mejor];
  }
  if (u_poster > 1.5) {
    float paso = u_poster - 1.0;
    x = floor(x * paso + 0.5) / paso;
  }
  // Busqueda del tramo por POSICION, no por indice: los puntos ya no estan repartidos a
  // intervalos iguales (los tres neutros viven comprimidos en el 10 % mas alto).
  int i = 0;
  for (int k = 0; k < 9; k++) {
    if (x > u_pos[k + 1]) i = k + 1;
  }
  float t0 = u_pos[i];
  float t1 = u_pos[i + 1];
  float f = (t1 > t0) ? (x - t0) / (t1 - t0) : 0.0;
  return mix(u_rampa[i], u_rampa[i + 1], f);
}

// Tono de la celda en el magenta del hocico (300deg-10deg). Mismo criterio que el 2D.
bool tonoHocico(vec2 cell) {
  vec4 t = texel(cell);
  if (t.a < u_empty) return false;
  float mx = max(t.r, max(t.g, t.b));
  float mn = min(t.r, min(t.g, t.b));
  float d = mx - mn;
  if (d <= 0.0) return false;
  float sector = (mx == t.r) ? mod((t.g - t.b) / d, 6.0)
               : (mx == t.g) ? (t.b - t.r) / d + 2.0
                             : (t.r - t.g) / d + 4.0;
  float h = mod(sector * 60.0 + 360.0, 360.0);
  return h >= 300.0 || h < 10.0;
}

/**
 * Region del PELAJE del cuerpo. Decision de diseno, no derivada del dato — y hay medicion que
 * dice por que tiene que serlo.
 *
 * El hocico tenia senal propia (el tono magenta). El pelaje NO: el sujeto entero cabe en 11 de
 * tono, asi que no hay color que separar. Queda lo que si lo distingue: luminancia alta, que no
 * sea brillo puntual, y SUPERFICIE. Pero medido en measure-pelaje.ts, **ningun umbral separa
 * el hombro de la mandibula** —42 % contra 33 % con l>=0.60 n=12— porque para un detector local
 * son la misma cosa, y la mandibula acaba de separarse del blanco a proposito. Lo unico que las
 * distingue es DONDE estan: con x>0.55 la mandibula cae a 0 % y el hombro se queda en 42 %.
 *
 * El soporte mira solo la LUMINANCIA de las vecinas, no su highlight: pedir el highlight de las
 * 24 vecinas serian 216 lecturas de textura por celda, y el presupuesto de pintado son 4 ms.
 */
bool esPelaje(vec2 cell, float l, bool hi) {
  if (u_pelajeOn < 0.5 || hi || l < u_pelajeLuma) return false;
  if (cell.x / u_grid.x < u_pelajeX0 || cell.y / u_grid.y < u_pelajeY0) return false;
  int n = 0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      if (i == 0 && j == 0) continue;
      if (lumaAt(cell + vec2(float(i), float(j))) >= u_pelajeLuma) n++;
    }
  }
  return float(n) >= u_pelajeN;
}

/** Color forzado del pelaje: el tramo calido de la rampa, repartido por luminancia. */
vec3 colorPelaje(float l) {
  float t = clamp((l - u_pelajeLuma) / max(0.001, 1.0 - u_pelajeLuma), 0.0, 1.0);
  int i0 = int(u_pelajeI0);
  int i1 = int(u_pelajeI1);
  int idx = i0 + int(floor(t * float(i1 - i0 + 1)));
  return u_rampa[min(i1, idx)];
}

/**
 * Región del hocico. En 2D esto es tono + EROSIÓN + componentes conexas, quedándose con la
 * mayor. La erosión se porta tal cual (mata el salpicado suelto por el flanco, que es para lo
 * que estaba). Lo que NO se puede portar es el paso de componentes conexas: es un recorrido
 * global con pila, y en un shader cada píxel solo ve su vecindad. Con vídeo tampoco valdría
 * precalcularlo en CPU, porque la región se mueve con el animal.
 * Consecuencia medible: sobreviven los cumulos pequenos que el 2D descartaba (medidos alli en
 * 9, 8, 5, 3 y 1 celdas frente a las 76 del hocico). Ver scripts/check-gl-palette.ts
 */
bool esHocico(vec2 cell) {
  if (!tonoHocico(cell)) return false;
  // SOPORTE 5x5 (2026-09-09). El 3x3 de antes solo pedia 3 vecinas de 8, y eso lo pasan
  // cumulos de 4-9 celdas: por eso el rojo salia salpicado por todo el animal —el 10.7 % de la
  // tinta pintada— cuando el 2D, con componentes conexas, se queda solo con el del hocico.
  // Aqui no se puede recorrer la imagen, pero SI se puede exigir mas vecindad: una celda del
  // nucleo del hocico tiene casi sus 24 vecinas dentro de la region, y una de un cumulo de 9
  // no puede tener mas de 8. Es una aproximacion LOCAL a la conectividad, y el umbral se mide.
  int radio = (u_hocicoN > 0.5) ? 2 : 1;
  int n = 0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      if (i == 0 && j == 0) continue;
      if (abs(i) > radio || abs(j) > radio) continue;
      if (tonoHocico(cell + vec2(float(i), float(j)))) n++;
    }
  }
  return float(n) >= max(3.0, u_hocicoN);
}

void main() {
  // gl_FragCoord tiene el origen abajo; el retrato se compone de arriba abajo como en 2D.
  vec2 frag = vec2(gl_FragCoord.x, u_viewport.y - gl_FragCoord.y);
  vec2 cell = floor(frag / u_cellPx);
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= u_grid.x || cell.y >= u_grid.y) discard;

  float l = lumaAt(cell);
  if (l < u_empty) discard;

  // Onda de entrada (§6.3 punto 9): solo se dibuja lo que ya alcanzó el frente.
  // La MISMA perturbacion que la onda del clic: las dos comparten mecanismo, asi que romper el
  // circulo en una y dejarlo perfecto en la otra las haria parecer dos efectos distintos.
  float pert = perturbaFrente(cell, l);
  float d = distance(cell, u_revealO) + pert;
  if (d > u_revealR) discard;
  float crest = clamp(1.0 - (u_revealR - d) / float(${WAVE_BAND}), 0.0, 1.0);

  // Highlight = contraste local contra las 8 vecinas, igual que en 2D.
  float sum = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      sum += lumaAt(cell + vec2(float(i), float(j)));
    }
  }
  bool isHi = (l - sum / 8.0) > u_hlDelta;

  // PUNTERO (6.3 punto 8): eleva la luminancia y densifica el glifo. El COLOR ya no se fuerza
  // a blanco: sale de la mezcla de la sangria. Pintar --fg a pelo tapaba justo el centro del
  // derrame, medido el 2026-09-04 (la saturacion BAJABA un 23.5 % donde mas debia subir).
  float falloff = 0.0;
  if (u_pointer.x > -100.0) {
    float dp = distance(cell, u_pointer);
    if (dp <= u_pointerR) falloff = 1.0 - dp / u_pointerR;
  }
  float lp = clamp(l + ${POINTER_LIFT} * falloff, 0.0, 1.0);

  // Banda de densidad. Bajo el puntero se fuerza al menos la banda de 0.66, que es lo que hace
  // denseChar() en 2D para que la zona tocada destaque sobre su entorno.
  float lband = (falloff > 0.0) ? max(lp, 0.66) : lp;
  int band = 9;
  for (int b = 0; b < 10; b++) {
    if (lband < u_bandMax[b]) { band = b; break; }
  }

  // Shimmer: un 3 % de las celdas cambia de glifo cada 120 ms, doble en highlights (§6.3 p.7).
  uint cellId = uint(cell.y) * uint(u_grid.x) + uint(cell.x);
  float salt = 0.0;
  if (l > 0.35) {
    float r = float(hash(cellId ^ (uint(u_epoch) * 0x9E3779B9u)) & 0xFFFFu) / 65535.0;
    float rate = isHi ? ${SHIMMER_RATE * 2} : ${SHIMMER_RATE};
    if (r < rate) salt = u_epoch;
  }

  uint idx = uint(u_bandOff[band]) +
             hash(cellId + uint(salt) * 7919u) % uint(u_bandCnt[band]);

  // Muestreo del atlas: posición dentro de la baldosa = posición dentro de la celda.
  // Ripple del puntero: un leve desplazamiento horizontal del glifo DENTRO de su celda.
  // El 2D lo hace moviendo la x del fillText, que puede invadir la celda vecina; aqui se
  // desplaza la coordenada de muestreo del atlas, asi que el glifo se recorta en el borde de
  // la celda en vez de desbordar. Diferencia inapreciable a 2 px de amplitud.
  float rip = sin((cell.y + u_time * 0.002) * 1.7) * 2.0 * falloff;
  vec2 inCell = fract(frag / u_cellPx);
  inCell.x = clamp(inCell.x - rip / u_cellPx.x, 0.0, 1.0);
  vec2 tile = vec2(mod(float(idx), u_atlasGrid.x), floor(float(idx) / u_atlasGrid.x));
  float cover = texture(u_atlas, (tile + inCell) / u_atlasGrid).a;
  if (cover <= 0.0) discard;

  vec3 base = isHi ? u_fg : u_accent;
  float alpha = isHi ? (0.9 + 0.1 * lp) : (${ALPHA_FLOOR} + ${ALPHA_RANGE} * lp);

  // ONDA DE COLOR DEL CLIC. En vez de un crossfade uniforme de opacidad, la transición se
  // propaga desde el punto del clic con el MISMO mecanismo de distancia-al-origen que la onda
  // de entrada. En 2D esto obligo al fallback de dos canvas compuestos por opacidad porque
  // recalcular 36000 celdas por frame rompia el presupuesto; aqui la distancia por celda ya se
  // calcula por pixel, asi que sale gratis.
  float dc = distance(cell, u_colorO) + pert;
  float frente = clamp((u_colorR - dc) / ${COLOR_BAND}.0, 0.0, 1.0);
  // El estado de fuera del frente es EXPLICITO, no (1 - target): al arrancar, destino y
  // estado previo valen los dos 0 (ASCII), y derivarlo daba 1 — el retrato salía en color
  // pleno desde el primer frame. Lo destapó la captura, no los números.
  float ondaMix = mix(u_colorBase, u_colorTarget, frente);

  // La sangria del hover y la onda del clic comparten destino: manda la mayor (mixFor del 2D).
  float bleed = texture(u_bleed, (cell + 0.5) / u_grid).r;
  float mezcla = max(bleed, ondaMix);

  if (mezcla > 0.0) {
    vec3 dest = (u_palette == 0)                            ? texel(cell).rgb
              : (u_hocicoOn > 0.5 && esHocico(cell))        ? u_hocico
              : (u_palette >= 3)                            ? colorRampa(l, isHi)
                                                            : colorDe(u_palette, l);
    // PELAJE: se pisa el color que saliera de la rampa. Va DESPUES de ella y ANTES del
    // highlight, porque el brillo puntual manda sobre la decision de region — los dientes no
    // son pelaje. El frio sigue estando por encima, que era la decision anterior.
    if (esPelaje(cell, l, isHi)) dest = colorPelaje(l);
    // El highlight, POR ENCIMA del gradiente. Medido en measure-reparto.ts: el 60.9 % de los
    // highlights ya cae en t>0.7, donde la rampa da casi-blanco de por si — para esos la capa
    // sobra. Pero el 39.1 % restante vive en la zona cobre/siena, y sin capa pasan de blanco a
    // marron medio y se pierde el brillo que dibuja el pelaje. Por eso es una opcion medida y
    // no una decision silenciosa.
    // La capa del highlight NO pisa la franja mas alta: ahi manda el tono frio, que es
    // justo donde se queria ver. Por debajo del tope, el highlight sigue mandando.
    if (isHi && u_hlModo > 0.5) {
      dest = (u_hlModo < 1.5) ? u_fg : u_hlNeutro;
    }
    // El frio va a los highlights MAS EXTREMOS, que es lo que se pidio: luminancia alta Y
    // contraste local. Solo con luminancia no se puede acotar — MEDIDO en measure-luma-gl.ts:
    // la curva de contraste satura el 34.7 % del dibujo en l>=0.995, asi que cualquier umbral
    // por debajo de 1.0 se traga ese pico entero y el frio pasaba a ser el color del animal
    // (56 % de la tinta pintada). Cruzarlo con isHi lo devuelve a ser un acento.
    // El frio va a una BANDA MEDIA de luminancia —donde esta la coronilla de nuestro jaguar,
    // medido en measure-cabeza.ts: 0.63-0.77— y opcionalmente acotado tambien EN ESPACIO.
    // Lo segundo hace falta porque en la referencia el azul es una REGION, no una banda: por
    // luminancia sola, el mismo tono aparece repartido por todo el animal.
    float fy = cell.y / u_grid.y;
    bool enBanda = l >= u_frioMin && l <= u_frioMax;
    bool enZona = u_frioZona < 0.5 || (fy >= u_frioY0 && fy <= u_frioY1);
    if (enBanda && enZona) dest = u_frio;
    base = mix(base, dest, mezcla);
    alpha = mix(alpha, 0.55 + 0.45 * lp, mezcla);
  }

  // La cresta de la onda de entrada va a alpha 1, como la piedra al caer al agua.
  alpha = mix(alpha, 1.0, crest);

  outColor = vec4(base * cover * alpha, cover * alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('No se pudo crear el shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`Shader: ${gl.getShaderInfoLog(sh) ?? '?'}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('No se pudo crear el programa');
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, QUAD_VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`Link: ${gl.getProgramInfoLog(p) ?? '?'}`);
  }
  return p;
}

function readToken(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const f =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [
    parseInt(f.slice(0, 2), 16) / 255,
    parseInt(f.slice(2, 4), 16) / 255,
    parseInt(f.slice(4, 6), 16) / 255,
  ];
}

export class AsciiPortraitGL implements Module {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly opts: Required<AsciiGLOptions>;
  /**
   * Fuente. Acepta imagen además de vídeo por una razón concreta: la única forma honesta de
   * verificar la PARIDAD con el Canvas 2D es renderizar la MISMA fuente con los dos motores.
   * Comparar GL+vídeo contra 2D+foto mezcla el cambio de motor con el cambio de material y no
   * demuestra nada. Ver `scripts/check-gl-parity.ts`.
   */
  private readonly video: HTMLVideoElement | HTMLImageElement;
  private readonly isVideo: boolean;

  private lumaProg!: WebGLProgram;
  private glyphProg!: WebGLProgram;
  private bleedProg!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private videoTex!: WebGLTexture;
  private lumaTex!: WebGLTexture;
  private atlasTex!: WebGLTexture;
  private fbo!: WebGLFramebuffer;
  /** Ping-pong de la sangría: se lee de una y se escribe en la otra, y se intercambian. */
  private bleedTex: WebGLTexture[] = [];
  private bleedFbo: WebGLFramebuffer[] = [];
  private bleedSrc = 0;

  // Puntero, en coordenadas de celda. -999 = fuera.
  private pointerX = -999;
  private pointerY = -999;
  private targetX = -999;
  private targetY = -999;
  private hasPointer = false;
  private lastBleed = 0;

  // Onda de color del clic
  private colorOX = 0;
  private colorOY = 0;
  private colorR = 0;
  private colorTarget = 0;
  /**
   * Duración de la onda de color. Es ajustable SOLO para poder fotografiarla a media
   * expansión: a 0.9 s la latencia de una captura de Playwright ya la pilla casi terminada.
   * En producción vale COLOR_WAVE_S.
   */
  private colorWaveS = COLOR_WAVE_S;
  private bleedTone = BLEED_TONE;
  private bleedEdge = BLEED_EDGE;
  /** Lo que se ve FUERA del frente de la onda: el modo anterior al clic. */
  private colorBase = 0;
  private modo: 'ascii' | 'color' = 'ascii';

  private cols = 1;
  private rows = 1;
  private cw = 4;
  private ch = 4;
  private dpr = 1;
  private ready = false;
  /**
   * `prefers-reduced-motion`. Decisión de Javier: el vídeo es un loop ambiental CONTINUO, no
   * gateado por hover — pero eso es exactamente lo que esta media query pide desactivar, y §8
   * lo exige (`check-phase3` comprueba que el retrato queda estático). Con reduced-motion el
   * vídeo se pausa en su primer frame y el shimmer se congela: el retrato sigue completo y
   * legible, simplemente no se mueve.
   */
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private raf = 0;
  private lastSample = 0;
  private revealR = 1e6;
  private pendingReveal: number | null = null;
  /**
   * Tamaño intrínseco de la fuente, anotado cuando carga y ANTES de insertar el vídeo en el
   * DOM. Medido en `diag-ocultar-video.ts`: con el elemento dentro del DOM, WebKit devuelve en
   * `videoWidth`/`videoHeight` el tamaño de la CAJA de layout (320x180 → "130x180"), no el del
   * clip. `srcRect()` usa esa proporción para el recorte `cover`, así que leerla del elemento ya
   * insertado desencuadraría el retrato. Fuera del DOM sí da el valor real (580x806).
   */
  private srcSize: [number, number] | null = null;
  /** Último rechazo de `play()`, para el panel de `?diag`. Público a propósito. */
  playError: string | null = null;

  /** Ganancia fija en vez de la curva. `null` = curva. Gancho de sondas y de `?glgain`. */
  gainOverride: number | null = null;
  /**
   * Congela el vídeo sin que el guardián lo vuelva a arrancar. Hace falta para comparar el
   * MISMO fotograma con distintas ganancias; sin esto, `onVideoPause` lo relanza al instante.
   */
  frozen = false;

  /**
   * Exposición del frame actual. 1 = tal cual viene la fuente.
   *
   * Por qué existe: la calibración del retrato (contraste 1.4, umbral de tinta 0.12,
   * `hlDelta` 0.11) se hizo contra una FOTO, que tiene una luminancia fija. El vídeo no: a lo
   * largo de sus 7.6 s el mismo encuadre pasa de 10 807 celdas con tinta a 5 844 —medido en
   * `diag-celdas-video.ts`— mientras la foto rinde 10 450 constantes. En los tramos oscuros el
   * retrato se queda a la mitad de densidad, y eso es lo que se ve como «se aprecia menos el
   * arte»: no es nitidez (el rasterizado es idéntico, medido en `compare-nitidez.ts`), es
   * DENSIDAD. Aquí se normaliza la exposición de cada frame para que la densidad se mantenga
   * donde estaba calibrada en vez de seguir al brillo del clip.
   */
  private gain = 1;

  /** Coste medido, en ms. Lo leen las sondas por `dataset`. */
  private tUpload = 0;
  private tSample = 0;
  private tFrame = 0;

  constructor(canvas: HTMLCanvasElement, options: AsciiGLOptions) {
    this.canvas = canvas;
    this.opts = {
      cellW: 4,
      cellH: 4,
      contrast: 1.4,
      smooth: 0.6,
      highlightDelta: 0.11,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      revealOrigin: { x: 0.28, y: 0.36 },
      // Zoom y foco decididos por Javier tras ver `scripts/sweep-zoom.ts`. El zoom solo va
      // hacia dentro (el corte de la fuente está clavado al borde inferior) y el foco no puede
      // ser centrado: se comería los bigotes, que dejan 16 px de margen sobre 580.
      zoom: 1.2,
      focus: { x: 0.1, y: 1 },
      palette: 'poster',
      poster: POSTER_ESCALONES,
      snap: true,
      hlSolo: true,
      hlBaja: 1,
      hlModo: 2,
      hocico: true,
      hocicoSoporte: 20,
      pelaje: true,
      pelajeLuma: 0.6,
      pelajeSoporte: 12,
      pelajeX0: 0.55,
      pelajeY0: 0.4,
      pelajeI0: 4,
      pelajeI1: 6,
      frio: true,
      frioMin: 0.62,
      frioMax: 0.78,
      frioZona: true,
      frioY0: 0.34,
      frioY1: 0.54,
      ondaRuido: 6,
      ondaEscala: 14,
      ondaTono: 0,
      ondaEase: 2,
      colorMix: 0,
      bleed: true,
      hover: true,
      waveSeconds: COLOR_WAVE_S,
      atlasFilter: 'linear',
      exposure: true,
      interactive: true,
      onModeChange: () => {},
      ...options,
    };

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      // El retrato se lee con sondas (`toDataURL`, screenshots): sin esto el buffer se
      // descarta tras componer y las capturas salen vacías de forma intermitente.
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;

    this.colorWaveS = this.opts.waveSeconds;
    this.isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(this.opts.src);
    if (this.isVideo) {
      const v = document.createElement('video');
      v.src = this.opts.src;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      // `autoplay` en el elemento no basta cuando se crea por JS y no está en el DOM.
      v.setAttribute('muted', '');
      this.video = v;
    } else {
      const img = new Image();
      img.src = this.opts.src;
      this.video = img;
    }

    void this.init();
  }

  private async init(): Promise<void> {
    const gl = this.gl;

    this.lumaProg = link(gl, LUMA_FS);
    this.glyphProg = link(gl, GLYPH_FS);
    this.bleedProg = link(gl, BLEED_FS);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('VAO');
    this.vao = vao;

    this.videoTex = this.makeTexture(gl.LINEAR);
    this.lumaTex = this.makeTexture(gl.NEAREST);
    this.atlasTex = this.makeTexture(this.opts.atlasFilter === 'nearest' ? gl.NEAREST : gl.LINEAR);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('FBO');
    this.fbo = fbo;

    for (let i = 0; i < 2; i++) {
      this.bleedTex.push(this.makeTexture(gl.NEAREST));
      const f = gl.createFramebuffer();
      if (!f) throw new Error('FBO de sangría');
      this.bleedFbo.push(f);
    }

    await new Promise<void>((resolve, reject) => {
      const el = this.video;
      const ok = this.isVideo
        ? (el as HTMLVideoElement).readyState >= 2
        : (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0;
      if (ok) {
        resolve();
        return;
      }
      el.addEventListener(this.isVideo ? 'loadeddata' : 'load', () => resolve(), { once: true });
      el.addEventListener('error', () => reject(new Error('La fuente no cargó')), { once: true });
    });
    if (this.isVideo) {
      const v = this.video as HTMLVideoElement;
      // El orden importa: primero se anota el tamaño real (aún fuera del DOM, ver `srcSize`),
      // y solo después se inserta.
      this.srcSize = [v.videoWidth, v.videoHeight];
      this.attachVideo(v);
      // Se reproduce TAMBIÉN con reduced-motion, aunque el retrato vaya a quedarse quieto: un
      // vídeo que nunca se ha reproducido no ha presentado ningún frame, y sin frame presentado
      // WebKit sube una textura en negro. Medido con `diag-movil.ts --reducido`: antes de esto,
      // con reduced-motion el retrato salía vacío en WebKit (tinta 0 durante los 14 s) — el
      // mismo hueco del bug, para todo el que lleve el ajuste puesto en el teléfono. Se le deja
      // dar un frame, el bucle lo muestrea una vez y ahí mismo se congela (ver `loop`).
      await v.play().catch((e: Error) => {
        // Se anota en vez de tragárselo: en un teléfono sin depurador, saber que `play()` fue
        // rechazado (y con qué nombre) es la diferencia entre "lo bloquea la política" y "no
        // dibuja pase lo que pase". El panel de `?diag` lo enseña.
        this.playError = `${e.name}: ${e.message}`;
      });
      if (this.reduced) await this.esperarFramePresentado(v);
    }

    this.resize();
    if (this.opts.interactive) {
      if (this.opts.hover) this.engancharHover();
      else this.canvas.addEventListener('pointermove', this.avisarHoverBloqueado);
      this.canvas.addEventListener('click', this.onClick);
      this.canvas.style.cursor = 'pointer';
    }
    this.canvas.dataset.glMode = 'ascii';
    this.ready = true;
    this.canvas.dataset.glReady = '1';
    this.loop();

    // Si el reveal se pidió antes de estar listos, se lanza ahora que ya hay rejilla.
    if (this.pendingReveal !== null) {
      const d = this.pendingReveal;
      this.pendingReveal = null;
      this.reveal(d);
    }
  }

  /**
   * Inserta el <video> en el documento. NO es cosmético: es la razón por la que el retrato no
   * aparecía en el móvil (bug de 2026-09-08).
   *
   * Medido en `diag-fuente.ts` sobre WebKit —el motor de Safari en iOS— con el MISMO mp4: un
   * <video> creado por JS y nunca insertado llega a `readyState 4` y se reproduce (`paused
   * false`, `currentTime` avanzando), pero no entrega un solo frame: 0 píxeles de tinta tanto
   * subiéndolo a una textura WebGL2 como dibujándolo en un canvas 2D. Insertado, 4096 de 4096.
   * En Chrome funciona de las dos maneras, y por eso el bug no salió en ninguna sonda de
   * escritorio: el retrato se veía perfecto mientras en el teléfono era un hueco.
   *
   * `display:none` lo vuelve a romper (medido, misma sonda), así que no vale ocultarlo así.
   *
   * Y el TAMAÑO de la caja tampoco es libre: WebKit sube a la textura lo que tiene PRESENTADO,
   * no lo que tiene decodificado. Barrido en `diag-parpadeo.ts` (24 capturas del compositor por
   * caja, se cuentan las que salen en negro):
   *     caja de 2 px .................. 10 de 24 vacías  → el retrato estrobaba
   *     tamaño natural (580x806) ......  2 de 24 vacías
   *     cubriendo el hero, opacidad 0 .  0 de 24 vacías  ← esta
   * Con `opacity: 0` se sigue presentando (y por tanto subiendo), así que no hace falta dejar
   * un 1 % de vídeo a la vista: no se ve absolutamente nada de él.
   */
  private attachVideo(v: HTMLVideoElement): void {
    if (v.isConnected) return;
    v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    // iOS antiguo solo entiende el atributo con prefijo, y sin reproducción en línea el vídeo
    // se abriría a pantalla completa en vez de alimentar la textura.
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('playsinline', '');
    // `opacity: 0.01` y no `0`. Las dos midieron igual de bien en el WebKit de escritorio
    // (0 de 24 capturas vacías), pero una capa totalmente transparente es candidata a que el
    // compositor la descarte, y si iOS la descarta no la presenta — y sin presentar no hay
    // frame que subir a la textura, que es exactamente el bug. Un 1 % sobre fondo oscuro son
    // ~2 niveles de 255: invisible, y no depende de que el compositor sea amable.
    v.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.01;pointer-events:none';
    const padre = this.canvas.parentElement;
    // Delante del canvas en el DOM: aunque sea invisible, así nunca puede pintarse por encima.
    if (padre) padre.insertBefore(v, this.canvas);
    else document.body.appendChild(v);

    // Un <video> pausado deja de entregar frames en WebKit, igual que uno sin insertar: la
    // textura se queda negra y el retrato desaparece. Y se pausa solo: MEDIDO en
    // `diag-movil.ts`, al dar la vuelta al loop (t≈7.5 s) WebKit lo deja en `paused true,
    // currentTime 0.01` y la tinta cae a 0 para siempre. En el teléfono eso es el retrato
    // apareciendo y esfumándose a los ocho segundos. Se vuelve a arrancar siempre que se pare.
    v.addEventListener('pause', this.onVideoPause);
    v.addEventListener('ended', this.onVideoPause);

    // Y si lo que lo bloquea es la política de autoplay (en iOS, el modo de bajo consumo la
    // aplica incluso a vídeo mudo), el primer gesto del usuario lo arranca. No se puede
    // comprobar en un emulador, así que se deja puesto: no cuesta nada y cubre el caso.
    document.addEventListener('pointerdown', this.onFirstGesture, { once: true, passive: true });
    document.addEventListener('touchstart', this.onFirstGesture, { once: true, passive: true });
  }

  /**
   * Espera a que el vídeo PRESENTE un frame (no solo a que lo tenga descodificado, que es lo
   * que dice `readyState`). `requestVideoFrameCallback` es exactamente esa señal; donde no
   * exista, dos vueltas de rAF y un tope de 1 s, que es de sobra para un frame ya cargado.
   */
  private esperarFramePresentado(v: HTMLVideoElement): Promise<void> {
    return new Promise<void>((resolve) => {
      let hecho = false;
      const listo = (): void => {
        if (hecho) return;
        hecho = true;
        resolve();
      };
      const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
        .requestVideoFrameCallback;
      if (typeof rvfc === 'function') rvfc.call(v, listo);
      else requestAnimationFrame(() => requestAnimationFrame(listo));
      setTimeout(listo, 1000);
    });
  }

  private readonly onVideoPause = (): void => {
    // `destroy()` pone `ready` a false antes de pausar: así su pausa no se deshace sola.
    if (!this.ready || this.reduced || this.frozen) return;
    void (this.video as HTMLVideoElement).play().catch(() => {});
  };

  private readonly onFirstGesture = (): void => {
    if (!this.isVideo || this.reduced) return;
    const v = this.video as HTMLVideoElement;
    if (v.paused) void v.play().catch(() => {});
  };

  private makeTexture(filter: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) throw new Error('Textura');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return t;
  }

  private resize(): void {
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);

    // Mismo `pixelSnap` que en 2D: la celda cae en un entero de dispositivo.
    this.cw = Math.max(1, Math.round(this.opts.cellW * this.dpr)) / this.dpr;
    this.ch = Math.max(1, Math.round(this.opts.cellH * this.dpr)) / this.dpr;
    this.cols = Math.max(1, Math.floor(rect.width / this.cw));
    this.rows = Math.max(1, Math.floor(rect.height / this.ch));

    // El `fontSize` se deduce del alto de la tinta igual que en 2D, con un canvas de sonda.
    const probe = document.createElement('canvas').getContext('2d');
    let fs = this.ch;
    if (probe) {
      probe.font = `${this.ch}px ${this.opts.fontFamily}`;
      let ink = 0;
      for (const c of `.'\`:,;-~+17cr23ae56bd89AE04BCDF68#%@`) {
        const m = probe.measureText(c);
        ink = Math.max(ink, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
      }
      if (ink > 0) fs = this.ch * (this.ch / ink);
    }

    const atlas = buildGlyphAtlas(this.cw, this.ch, fs, this.opts.fontFamily, this.dpr);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    this.atlasGrid = [atlas.cols, atlas.rows];

    gl.bindTexture(gl.TEXTURE_2D, this.lumaTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.cols, this.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lumaTex, 0);

    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.bleedTex[i] as WebGLTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.cols, this.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bleedFbo[i] as WebGLFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.bleedTex[i] as WebGLTexture,
        0,
      );
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.canvas.dataset.glGrid = `${this.cols}x${this.rows}`;
  }

  private atlasGrid: [number, number] = [6, 6];

  /** Recorte `cover` en UV, con el zoom aplicado. Calco del §6.3 punto 2. */
  private srcRect(): [number, number, number, number] {
    // `srcSize` manda cuando existe: es el tamaño leído antes de insertar el vídeo (ver arriba).
    const vw =
      (this.srcSize?.[0] ??
        (this.isVideo
          ? (this.video as HTMLVideoElement).videoWidth
          : (this.video as HTMLImageElement).naturalWidth)) ||
      1;
    const vh =
      (this.srcSize?.[1] ??
        (this.isVideo
          ? (this.video as HTMLVideoElement).videoHeight
          : (this.video as HTMLImageElement).naturalHeight)) ||
      1;
    const target = (this.cols * this.cw) / (this.rows * this.ch);
    const src = vw / vh;

    let w = 1;
    let h = 1;
    if (src > target) w = target / src;
    else h = src / target;

    w /= this.opts.zoom;
    h /= this.opts.zoom;
    // El punto focal reparte el margen sobrante en vez de centrarlo.
    return [(1 - w) * this.opts.focus.x, (1 - h) * this.opts.focus.y, w, h];
  }

  /**
   * Exposición del vídeo. CONSTANTE, no una curva por frame.
   *
   * El diagnóstico de partida era correcto —el clip se oscurece y se aclara, y sin corregir el
   * retrato pierde densidad— pero la primera corrección SOBRECORREGÍA: perseguía igualar el
   * conteo de celdas de la foto y llenaba el retrato de glifos pesados, comiéndose justo el
   * detalle que se quería salvar. El criterio correcto no es el conteo: es la TEXTURA, medida
   * como contraste medio entre celdas vecinas. Si todo satura al mismo glifo denso, las celdas
   * se parecen entre sí y la textura baja: eso es «lleno pero sin textura».
   *
   * Medido en `sweep-gain.ts` sobre el MISMO fotograma (el más oscuro y el más claro del clip)
   * y confirmado en `check-textura-loop.ts` recorriendo el loop entero. Ancla: el Canvas 2D ya
   * calibrado, textura 25.10.
   *
   *     ganancia   loop: celdas / textura     oscuro     claro
   *     1.0        7873 / 23.50               25.00      22.13
   *     1.2        8464 / 24.86               26.37      23.95
   *     1.4        9262 / 24.89  <-           26.22      24.35
   *     1.6        9710 / 24.45               25.54      24.00
   *     2.6           -- / 20.6               21.43      19.75
   *
   * 1.2 y 1.4 empatan en textura; 1.4 gana porque da 800 celdas más con el mismo detalle. A
   * partir de 1.6 la textura cae, y en 2.6 se queda un 15 % por debajo del ancla.
   *
   * OJO al medir esto: las dos primeras corridas del barrido salieron contaminadas. La sangría
   * del hover tiñe el retrato de color en un radio de 26 celdas y el recorte caía dentro, así
   * que se estaba midiendo el modo COLOR. Las sondas ahora quitan el puntero y se niegan a
   * medir si detectan píxeles cálidos. Es el mismo fallo ya anotado para `check-gl-bleed`.
   */
  /**
   * Ganancia de exposición. **1.2 desde el 2026-09-09**, decisión de Javier sobre
   * `measure-expo-color.ts`, que mide los DOS criterios sobre el mismo píxel.
   *
   * El 1.4 anterior salió de medir solo TEXTURA, y en ASCII, donde saturar no cambia el color
   * —solo el glifo—. Medido con los dos criterios juntos: entre 1.2 y 1.4 no hay trade-off que
   * pagar. En el fotograma oscuro la textura SUBE al bajar a 1.2 (26.29 contra 26.15), o sea
   * que 1.4 ya estaba pasado de rosca para el detalle; en el claro se pierde un 1.5 %. A cambio
   * cambian de familia catorce puntos de la tinta: cálidas 33.4 -> 47.0 %, blancas 57.6 ->
   * 42.4 %. Por debajo de 1.2 sí se paga: en 1.0 la textura cae un 9.1 %.
   */
  private static readonly EXPO_GANANCIA = 1.2;

  private actualizarGanancia(): void {
    if (!this.isVideo) return;
    // Ganancia fija: `?glgain=1.4` o `__asciiGL.gainOverride`. Es el gancho con el que se
    // barrió el mismo fotograma para elegir el valor de arriba.
    if (this.gainOverride !== null) {
      this.gain = this.gainOverride;
    } else {
      this.gain = this.opts.exposure ? AsciiPortraitGL.EXPO_GANANCIA : 1;
    }
    this.canvas.dataset.glGain = this.gain.toFixed(3);
  }

  private sampleVideo(): void {
    const gl = this.gl;

    this.actualizarGanancia();
    const t0 = performance.now();
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
    this.tUpload = performance.now() - t0;

    const t1 = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.cols, this.rows);
    // El estado de GL es global y persiste entre frames: sin esto, el `enable(BLEND)` que deja
    // la pasada 2 sigue activo aquí y la textura de luma se compone sobre sí misma frame tras
    // frame hasta saturar. Síntoma: el retrato sale como una silueta sólida sin glifos, porque
    // con luma ~1 todas las celdas caen en la última banda (`#%@`) a alpha 1.
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.lumaProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.uniform1i(gl.getUniformLocation(this.lumaProg, 'u_video'), 0);
    gl.uniform2f(gl.getUniformLocation(this.lumaProg, 'u_grid'), this.cols, this.rows);
    gl.uniform4fv(gl.getUniformLocation(this.lumaProg, 'u_srcRect'), this.srcRect());
    gl.uniform1f(gl.getUniformLocation(this.lumaProg, 'u_contrast'), this.opts.contrast);
    gl.uniform1f(gl.getUniformLocation(this.lumaProg, 'u_gain'), this.gain);
    // `smooth` está en px de la rejilla 2x, así que en celdas vale la mitad. La caja del
    // downsample ya NO se suma aquí: la aportan las cuatro sub-muestras del shader.
    const sigma = Math.max(1e-4, this.opts.smooth * 0.5);
    gl.uniform1f(gl.getUniformLocation(this.lumaProg, 'u_sigma'), sigma);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.tSample = this.tUpload + (performance.now() - t1);
  }

  /** Un paso del autómata de la sangría. Escribe en la textura libre y las intercambia. */
  private stepBleed(dt: number): void {
    const gl = this.gl;
    const dst = 1 - this.bleedSrc;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bleedFbo[dst] as WebGLFramebuffer);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.disable(gl.BLEND);
    gl.useProgram(this.bleedProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lumaTex);
    gl.uniform1i(gl.getUniformLocation(this.bleedProg, 'u_luma'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bleedTex[this.bleedSrc] as WebGLTexture);
    gl.uniform1i(gl.getUniformLocation(this.bleedProg, 'u_prev'), 1);

    gl.uniform2f(gl.getUniformLocation(this.bleedProg, 'u_grid'), this.cols, this.rows);
    gl.uniform2f(gl.getUniformLocation(this.bleedProg, 'u_pointer'), this.pointerX, this.pointerY);
    gl.uniform1f(gl.getUniformLocation(this.bleedProg, 'u_dt'), dt);
    gl.uniform1f(gl.getUniformLocation(this.bleedProg, 'u_tone'), this.bleedTone);
    gl.uniform1f(gl.getUniformLocation(this.bleedProg, 'u_edge'), this.bleedEdge);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.bleedSrc = dst;
  }

  private draw(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const p = this.glyphProg;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lumaTex);
    gl.uniform1i(gl.getUniformLocation(p, 'u_luma'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(gl.getUniformLocation(p, 'u_atlas'), 1);

    gl.uniform2f(gl.getUniformLocation(p, 'u_grid'), this.cols, this.rows);
    gl.uniform2f(gl.getUniformLocation(p, 'u_cellPx'), this.cw * this.dpr, this.ch * this.dpr);
    gl.uniform2f(gl.getUniformLocation(p, 'u_atlasGrid'), this.atlasGrid[0], this.atlasGrid[1]);
    gl.uniform1fv(gl.getUniformLocation(p, 'u_bandMax'), Float32Array.from(BAND_MAX));
    gl.uniform1fv(gl.getUniformLocation(p, 'u_bandOff'), Float32Array.from(BAND_OFFSET));
    gl.uniform1fv(gl.getUniformLocation(p, 'u_bandCnt'), Float32Array.from(BAND_COUNT));
    // El retrato pinta sobre casi-negro, así que NO usa el relleno de marca: usa la variante
    // clara del acento. Con la guinda a pelo (luminancia 0.096 contra 0.734 del verde anterior)
    // el dibujo se apaga — está medido en `measure-acento.ts`. El respaldo del token lleva el
    // MISMO valor que `tokens.css`: un respaldo desactualizado reintroduce el color viejo sin
    // que nadie se entere, que es justo lo que la auditoría encontró con el verde.
    gl.uniform3fv(gl.getUniformLocation(p, 'u_accent'), hexToRgb(readToken('--accent', '#39ff6a')));
    gl.uniform3fv(gl.getUniformLocation(p, 'u_fg'), hexToRgb(readToken('--fg', '#eeeeee')));
    gl.uniform1f(gl.getUniformLocation(p, 'u_hlDelta'), this.opts.highlightDelta);
    gl.uniform1f(gl.getUniformLocation(p, 'u_empty'), EMPTY);
    gl.uniform1f(
      gl.getUniformLocation(p, 'u_epoch'),
      this.reduced ? 0 : Math.floor(performance.now() / SHIMMER_MS),
    );
    gl.uniform1f(gl.getUniformLocation(p, 'u_revealR'), this.revealR);
    gl.uniform2f(
      gl.getUniformLocation(p, 'u_revealO'),
      this.opts.revealOrigin.x * this.cols,
      this.opts.revealOrigin.y * this.rows,
    );
    gl.uniform2f(gl.getUniformLocation(p, 'u_viewport'), this.canvas.width, this.canvas.height);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.bleedTex[this.bleedSrc] as WebGLTexture);
    gl.uniform1i(gl.getUniformLocation(p, 'u_bleed'), 2);
    gl.uniform2f(gl.getUniformLocation(p, 'u_pointer'), this.pointerX, this.pointerY);
    gl.uniform1f(gl.getUniformLocation(p, 'u_pointerR'), POINTER_RADIUS);
    gl.uniform2f(gl.getUniformLocation(p, 'u_colorO'), this.colorOX, this.colorOY);
    gl.uniform1f(gl.getUniformLocation(p, 'u_colorR'), this.colorR);
    gl.uniform1f(gl.getUniformLocation(p, 'u_colorTarget'), this.colorTarget);
    gl.uniform1f(gl.getUniformLocation(p, 'u_colorBase'), this.colorBase);
    gl.uniform1f(gl.getUniformLocation(p, 'u_time'), performance.now());

    // 3 = rampa de 11 tonos (continua o posterizada, lo decide u_poster).
    const modo =
      this.opts.palette === 'photo'
        ? 0
        : this.opts.palette === 'bands'
          ? 1
          : this.opts.palette === 'ramp'
            ? 2
            : 3;
    gl.uniform1i(gl.getUniformLocation(p, 'u_palette'), modo);
    gl.uniform1f(gl.getUniformLocation(p, 'u_colorMix'), this.opts.colorMix);
    gl.uniform1fv(gl.getUniformLocation(p, 'u_cortes'), Float32Array.from(CORTES));
    gl.uniform3fv(
      gl.getUniformLocation(p, 'u_anclas'),
      Float32Array.from(ANCLAS.flatMap((c) => [c[0] / 255, c[1] / 255, c[2] / 255])),
    );
    gl.uniform3fv(
      gl.getUniformLocation(p, 'u_rampa'),
      Float32Array.from(RAMPA.flatMap((c) => [c[0] / 255, c[1] / 255, c[2] / 255])),
    );
    gl.uniform3fv(
      gl.getUniformLocation(p, 'u_frio'),
      Float32Array.from([FRIO_ALTO[0] / 255, FRIO_ALTO[1] / 255, FRIO_ALTO[2] / 255]),
    );
    gl.uniform1fv(gl.getUniformLocation(p, 'u_pos'), Float32Array.from(POSICIONES));
    gl.uniform3fv(
      gl.getUniformLocation(p, 'u_hlNeutro'),
      Float32Array.from([HIGHLIGHT_NEUTRO[0] / 255, HIGHLIGHT_NEUTRO[1] / 255, HIGHLIGHT_NEUTRO[2] / 255]),
    );
    // Umbral del frío, INDEPENDIENTE de la posterización (ver el comentario del uniform).
    gl.uniform1f(gl.getUniformLocation(p, 'u_frioMin'), this.opts.frio ? this.opts.frioMin : 2);
    gl.uniform1f(gl.getUniformLocation(p, 'u_frioMax'), this.opts.frioMax);
    gl.uniform1f(gl.getUniformLocation(p, 'u_frioZona'), this.opts.frioZona ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_frioY0'), this.opts.frioY0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_frioY1'), this.opts.frioY1);
    gl.uniform1f(
      gl.getUniformLocation(p, 'u_poster'),
      this.opts.palette === 'poster' ? this.opts.poster || POSTER_ESCALONES : this.opts.poster,
    );
    gl.uniform1f(gl.getUniformLocation(p, 'u_hlModo'), this.opts.hlModo);
    gl.uniform1f(gl.getUniformLocation(p, 'u_snap'), this.opts.snap ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_pelajeOn'), this.opts.pelaje ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_pelajeLuma'), this.opts.pelajeLuma);
    gl.uniform1f(gl.getUniformLocation(p, 'u_pelajeN'), this.opts.pelajeSoporte);
    gl.uniform1f(gl.getUniformLocation(p, 'u_pelajeX0'), this.opts.pelajeX0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_pelajeY0'), this.opts.pelajeY0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_pelajeI0'), this.opts.pelajeI0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_pelajeI1'), this.opts.pelajeI1);
    gl.uniform1f(gl.getUniformLocation(p, 'u_ondaAmp'), this.opts.ondaRuido);
    gl.uniform1f(gl.getUniformLocation(p, 'u_ondaEscala'), Math.max(1, this.opts.ondaEscala));
    gl.uniform1f(gl.getUniformLocation(p, 'u_ondaTono'), this.opts.ondaTono);
    gl.uniform1f(gl.getUniformLocation(p, 'u_hlSolo'), this.opts.hlSolo ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_hlBaja'), this.opts.hlBaja);
    gl.uniform1f(gl.getUniformLocation(p, 'u_hocicoOn'), this.opts.hocico ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_hocicoN'), this.opts.hocicoSoporte);
    gl.uniform3fv(
      gl.getUniformLocation(p, 'u_hocico'),
      Float32Array.from([ACENTO_HOCICO[0] / 255, ACENTO_HOCICO[1] / 255, ACENTO_HOCICO[2] / 255]),
    );

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private readonly loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.ready) return;

    const t0 = performance.now();
    const now = t0;
    let sampled = false;
    // Con reduced-motion (o con fuente estática) basta muestrear una vez: no hay nada nuevo
    // que leer y re-subir la textura por frame sería trabajo puro de descarte.
    const necesitaMuestreo = this.isVideo && !this.reduced;
    if ((necesitaMuestreo || this.sampleSeq === 0) && now - this.lastSample >= 1000 / SAMPLE_HZ) {
      this.lastSample = now;
      this.sampleVideo();
      sampled = true;
      this.sampleSeq++;
      // Con reduced-motion ese primer muestreo es el único que habrá: la textura de luma se
      // queda con él y el retrato ya está completo, así que aquí se congela el vídeo. Pausarlo
      // antes habría dejado la textura en negro en WebKit; pausarlo ahora no borra nada.
      if (this.reduced && this.isVideo) (this.video as HTMLVideoElement).pause();
    }
    // Puntero suavizado con el mismo lerp 0.12 del 2D
    if (this.hasPointer) {
      this.pointerX =
        this.pointerX < -100 ? this.targetX : this.pointerX + (this.targetX - this.pointerX) * 0.12;
      this.pointerY =
        this.pointerY < -100 ? this.targetY : this.pointerY + (this.targetY - this.pointerY) * 0.12;
    } else {
      this.pointerX = -999;
      this.pointerY = -999;
    }

    // Sangría: se gatea con reduced-motion igual que en 2D, y se puede apagar por opción
    if (!this.reduced && this.opts.bleed && this.opts.interactive) {
      const dt = Math.min(0.05, (t0 - this.lastBleed) / 1000 || 0.016);
      this.lastBleed = t0;
      this.stepBleed(dt);
    }

    this.draw();
    this.tFrame = performance.now() - t0;

    this.canvas.dataset.glMs = `${this.tFrame.toFixed(2)}`;
    // La secuencia deja distinguir un frame CON muestreo de uno sin él. Sin esto, una sonda
    // que lea `glUpload` cada frame promedia el mismo valor repetido y no mide nada.
    this.canvas.dataset.glSampled = sampled ? '1' : '0';
    this.canvas.dataset.glSeq = `${this.sampleSeq}`;
    this.canvas.dataset.glUpload = `${this.tUpload.toFixed(2)}`;
    this.canvas.dataset.glSample = `${this.tSample.toFixed(2)}`;
  };

  private sampleSeq = 0;

  /** El elemento de vídeo, para las sondas: no está en el DOM, así que no se puede consultar. */
  get source(): HTMLVideoElement | HTMLImageElement {
    return this.video;
  }

  /** Tamaño de la fuente, sea vídeo o imagen. Lo leen las sondas. */
  get sourceSize(): [number, number] {
    return this.isVideo
      ? [(this.video as HTMLVideoElement).videoWidth, (this.video as HTMLVideoElement).videoHeight]
      : [(this.video as HTMLImageElement).naturalWidth, (this.video as HTMLImageElement).naturalHeight];
  }

  /**
   * EL CANDADO (2026-09-09). Cuatro mediciones distintas salieron contaminadas por lo mismo: el
   * puntero entra en el canvas sin que la sonda lo pretenda —al cerrar una pestaña, al asentar
   * el scroll— la sangría derrama color en un radio de 26 celdas, y lo que se acaba midiendo es
   * el modo COLOR creyendo que es el ASCII. Existía un helper para evitarlo desde hacía tres
   * incidentes; acordarse de usarlo no funcionó.
   *
   * Así que deja de depender de la memoria: bajo automatización el hover nace APAGADO, y la
   * única forma de encenderlo es `habilitarHover()`, que es lo que hace `scripts/lib/pointer.ts`.
   * Una sonda que no pase por el helper no puede teñir el retrato aunque mueva el ratón.
   *
   * Y para que apagarlo no cree un cero silencioso —que sería cambiar un fallo por otro—, cuando
   * está bloqueado se deja un testigo en `data-gl-hover-bloqueado` en cuanto alguien lo intenta:
   * así una sonda que mida sangría y saque cero puede decir POR QUÉ salió cero.
   */
  habilitarHover(): void {
    if (!this.opts.interactive || this.hoverEnganchado) return;
    this.canvas.removeEventListener('pointermove', this.avisarHoverBloqueado);
    this.engancharHover();
    delete this.canvas.dataset.glHoverBloqueado;
  }

  private hoverEnganchado = false;

  private engancharHover(): void {
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.hoverEnganchado = true;
    this.canvas.dataset.glHover = '1';
  }

  private readonly avisarHoverBloqueado = (): void => {
    this.canvas.dataset.glHoverBloqueado = '1';
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    this.targetX = ((e.clientX - r.left) / r.width) * this.cols;
    this.targetY = ((e.clientY - r.top) / r.height) * this.rows;
    this.hasPointer = true;
  };

  private readonly onPointerLeave = (): void => {
    this.hasPointer = false;
  };

  /**
   * Clic: dispara la ONDA DE COLOR desde el punto tocado. Decisión de Javier — en vez del
   * crossfade uniforme de opacidad del 2D, la transición se propaga con el mismo mecanismo de
   * distancia-al-origen que la onda de entrada del hero (§6.3 punto 9).
   */
  private readonly onClick = (e: PointerEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    this.colorOX = ((e.clientX - r.left) / r.width) * this.cols;
    this.colorOY = ((e.clientY - r.top) / r.height) * this.rows;
    this.colorBase = this.colorTarget; // lo que ya se estaba viendo se queda fuera del frente
    this.modo = this.modo === 'ascii' ? 'color' : 'ascii';
    this.colorTarget = this.modo === 'color' ? 1 : 0;
    this.canvas.dataset.glMode = this.modo;
    this.opts.onModeChange(this.modo);

    const max = Math.hypot(this.cols, this.rows) + COLOR_BAND;
    if (this.reduced) {
      // §6.3 punto 12: con reduced-motion el cambio de modo es instantáneo, sin onda.
      this.colorBase = this.colorTarget;
      this.colorR = max;
      this.canvas.dataset.glColorWave = '1.000';
      return;
    }
    const t0 = performance.now();
    this.colorR = 0;
    const step = (): void => {
      const p = Math.min(1, (performance.now() - t0) / (this.colorWaveS * 1000));
      this.colorR = (1 - (1 - p) ** this.opts.ondaEase) * max;
      this.canvas.dataset.glColorWave = p.toFixed(3);
      if (p < 1) requestAnimationFrame(step);
      // Al terminar, el destino pasa a ser el estado de base: así el retrato se queda como
      // quedó aunque el radio se reinicie en el clic siguiente.
      else this.colorBase = this.colorTarget;
    };
    step();
  };

  /** Cambia de modo sin clic (acceso por teclado, §8). La onda sale del centro. */
  toggleMode(): void {
    const r = this.canvas.getBoundingClientRect();
    this.onClick(
      new PointerEvent('click', {
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
  }

  /**
   * Borra la sangría acumulada. Necesario para medir con el cursor QUIETO: como las celdas
   * fuera del alcance conservan su valor (esa es justo la estela), cualquier movimiento previo
   * del ratón —incluido el necesario para que el canvas reciba el puntero— deja rastro y
   * contamina la medición de la forma.
   */
  clearBleed(): void {
    const gl = this.gl;
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bleedFbo[i] as WebGLFramebuffer);
      gl.viewport(0, 0, this.cols, this.rows);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Solo para sondas: cambia las constantes de la sangría en caliente, para barrerlas. */
  setBleedConstants(tone: number, edge: number): void {
    this.bleedTone = tone;
    this.bleedEdge = edge;
  }

  /** Solo para sondas: alarga la onda para poder capturarla a media expansión. */
  setWaveDuration(seconds: number): void {
    this.colorWaveS = seconds;
  }

  get currentMode(): 'ascii' | 'color' {
    return this.modo;
  }

  /** Onda de entrada, equivalente a `reveal()` del 2D. */
  reveal(duration = 3.2): void {
    // `init()` es asíncrono (espera a que cargue el vídeo) y `reveal()` lo dispara la promesa
    // del preloader: las dos carreras se cruzan. Si el reveal gana, `cols`/`rows` valen aún 1
    // y el radio máximo sale hypot(1,1)+7 = 8.41 CELDAS — la onda "termina" sin salir de un
    // disco diminuto y el retrato no aparece nunca. Pasó, y la captura del hero salió bien
    // solo porque en aquella corrida ganó `init()`. Se aplaza hasta tener rejilla.
    if (!this.ready) {
      this.pendingReveal = duration;
      return;
    }
    const t0 = performance.now();
    this.revealR = 0;
    const step = (): void => {
      // El máximo se recalcula por frame: si hay un resize a mitad del barrido, la onda se
      // adapta en vez de quedarse corta con la rejilla vieja.
      const max = Math.hypot(this.cols, this.rows) + WAVE_BAND;
      const p = Math.min(1, (performance.now() - t0) / (duration * 1000));
      // `power1.out` de GSAP es cuadrática (1-(1-p)^2), no lineal. Con el exponente 1 que
      // tenía aquí el barrido salía a velocidad constante, que es justo la curva que se
      // descartó midiendo en `compare-reveal.ts` el 2026-09-03.
      this.revealR = (1 - (1 - p) ** this.opts.ondaEase) * max;
      // Progreso observable, igual que el `dataset.reveal` del 2D: sin esto una sonda no
      // puede saber si el retrato ya está completo y acaba midiendo a mitad de la onda.
      this.canvas.dataset.glReveal = Math.min(1, p).toFixed(3);
      if (p < 1) requestAnimationFrame(step);
    };
    step();
  }

  get lastFrameMs(): number {
    return this.tFrame;
  }

  /**
   * Encuadre en caliente. El zoom SOLO va hacia dentro: el corte recto de la fuente está
   * clavado en el borde inferior del frame, así que retirar al animal devolvería negro debajo
   * y la recta volvería a flotar. `focus.y = 1` recorta todo por arriba y conserva ese borde.
   */
  setFrame(partial: { zoom?: number; focus?: { x: number; y: number } }): void {
    if (partial.zoom !== undefined) this.opts.zoom = partial.zoom;
    if (partial.focus !== undefined) this.opts.focus = partial.focus;
    this.canvas.dataset.glZoom = this.opts.zoom.toFixed(2);
    this.lastSample = 0; // fuerza un re-muestreo en el próximo frame
  }

  /** Cambia paleta y mezcla en caliente. El crossfade animado llega en 2.3. */
  setColor(partial: { palette?: PaletteMode; colorMix?: number }): void {
    if (partial.palette !== undefined) this.opts.palette = partial.palette;
    if (partial.colorMix !== undefined) this.opts.colorMix = partial.colorMix;
    this.canvas.dataset.glPalette = this.opts.palette;
    this.canvas.dataset.glMix = this.opts.colorMix.toFixed(2);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ready = false;
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointermove', this.avisarHoverBloqueado);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('click', this.onClick);
    if (this.isVideo) {
      const v = this.video as HTMLVideoElement;
      v.removeEventListener('pause', this.onVideoPause);
      v.removeEventListener('ended', this.onVideoPause);
      document.removeEventListener('pointerdown', this.onFirstGesture);
      document.removeEventListener('touchstart', this.onFirstGesture);
      v.pause();
      v.removeAttribute('src');
      v.load();
      // Ahora vive en el DOM, así que hay que sacarlo: si no, un HMR o un destroy() dejaría
      // vídeos huérfanos acumulándose bajo el hero.
      v.remove();
    }
  }
}
