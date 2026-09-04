// scripts/contact-sheet.ts — compone en una sola imagen los PNG de un directorio, para poder
// revisar de un vistazo los fotogramas sacados de un vídeo. El ffmpeg que trae Playwright es
// mínimo (24 filtros, sin `tile` ni `fps`), así que el mosaico se monta aquí.
// Uso: node scripts/contact-sheet.ts <dir> <salida.png> [columnas]

import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

async function main(): Promise<void> {
  const dir = resolve(process.argv[2] ?? 'screenshots/.vframes');
  const out = resolve(process.argv[3] ?? 'screenshots/contact-sheet.png');
  const cols = Number(process.argv[4] ?? 6);

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort();
  if (files.length === 0) throw new Error(`sin PNG en ${dir}`);

  const cells = files
    .map((f) => {
      const b64 = readFileSync(join(dir, f)).toString('base64');
      const label = f.replace(/^\d+_/, '').replace(/\.png$/, '');
      return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${label}</figcaption></figure>`;
    })
    .join('');

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#111;font:11px ui-monospace,monospace;color:#bbb;
         display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;padding:10px}
    figure{margin:0} img{display:block;width:100%;outline:1px solid #333}
    figcaption{padding-top:2px;text-align:center}
  </style>${cells}`;

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1500, height: 400 } });
  await page.setContent(html);
  await page.waitForLoadState('networkidle');
  await (await page.$('body'))?.screenshot({ path: out });
  await browser.close();
  console.log(`${files.length} fotogramas → ${out}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
