// scripts/measure-rampa.ts — mide la rampa de 11 tonos ANTES de aplicarla.
//
// La instrucción es interpolar entre los 11 puntos según la luminancia de la celda, o sea
// repartirlos a intervalos iguales en t = 0..1. Antes de hacerlo hay que saber qué luminancia
// tiene cada punto: si la rampa no es monótona, habrá una zona donde el retrato se OSCUREZCA
// al subir la luminancia, y eso se ve.
const RAMPA = [
  '#000000',
  '#1C0F08',
  '#421F09',
  '#6C3A13',
  '#98581A',
  '#C67E26',
  '#DFAC50',
  '#F2DB8E',
  '#978E7D',
  '#BFBCB3',
  '#F1F0EA',
];

const rgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const luma = ([r, g, b]: [number, number, number]): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const croma = ([r, g, b]: [number, number, number]): number => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
const tono = ([r, g, b]: [number, number, number]): number => {
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    d = mx - mn;
  if (d === 0) return -1;
  const s = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((s * 60 + 360) % 360);
};

console.log('== RAMPA DE 11 TONOS · medida ==');
console.log('   #  hex        t      luminancia   croma   tono°   salto de luminancia');
let prev = -1;
const L: number[] = [];
RAMPA.forEach((h, i) => {
  const c = rgb(h);
  const l = luma(c);
  L.push(l);
  const t = i / (RAMPA.length - 1);
  const salto =
    prev < 0 ? '' : (l - prev >= 0 ? '+' : '') + (l - prev).toFixed(3) + (l < prev ? '   <-- BAJA' : '');
  console.log(
    `  ${String(i).padStart(2)}  ${h}   ${t.toFixed(3)}   ${l.toFixed(4).padStart(9)}   ${croma(c).toFixed(3)}   ${String(tono(c)).padStart(4)}   ${salto}`,
  );
  prev = l;
});

const bajadas = L.map((l, i) => (i > 0 && l < (L[i - 1] ?? 0) ? i : -1)).filter((i) => i > 0);
console.log('');
console.log(
  `   monotonía: ${bajadas.length === 0 ? 'la rampa siempre sube' : `NO es monótona — baja en el punto ${bajadas.join(', ')}`}`,
);
if (bajadas.length) {
  for (const i of bajadas) {
    const caida = (L[i - 1] ?? 0) - (L[i] ?? 0);
    console.log(
      `   en t=${(i / 10).toFixed(2)} la luminancia cae ${caida.toFixed(3)} (${RAMPA[i - 1]} -> ${RAMPA[i]}), un ${((caida / (L[i - 1] ?? 1)) * 100).toFixed(0)} % menos`,
    );
  }
}
console.log('');
console.log('   familias por croma:');
RAMPA.forEach((h) => {
  const c = rgb(h);
  const k = croma(c);
  console.log(`     ${h}  ${k < 0.06 ? 'NEUTRO (gris)' : 'cálido'}`);
});
