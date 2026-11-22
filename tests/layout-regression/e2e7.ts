import * as pdfjs from '/tmp/v77/node_modules/pdfjs-dist/build/pdf.js';
import { translatePageWithLayout, analyzePage } from '/tmp/v77/src/services/layoutTranslationService';
(pdfjs as any).GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
const Q = new URLSearchParams(location.search); const PAGES: number[] = (Q.get('pages')||'1').split(',').map(Number); const PDF = Q.get('pdf')||'nb.pdf';
const res: any = { blocks: {} };
(async () => {
  try {
    const ff = new FontFace('Tinos', 'url(Tinos-Regular.ttf)'); await ff.load(); (document as any).fonts.add(ff);
    const doc = await (pdfjs as any).getDocument({ url: PDF }).promise;
    for (const p of PAGES) {
      const a: any = await analyzePage(doc, p);
      res.blocks[p] = a.blocks.map((b: any) => [b.text.slice(0, 60), Math.round(b.x0), Math.round(b.top), +b.size.toFixed(1), b.bold ? 'B' : '', b.lineCount, b.baseStyle?.color ? `${b.baseStyle.color.r},${b.baseStyle.color.g},${b.baseStyle.color.b}` : '', b.align, b.translatable ? '' : 'NT']);
      const tr: any = {
        translateLayoutBlocks: async (blocks: any[]) => Object.fromEntries(blocks.map(b => { const t = b.text.replace(/a/g, 'ă').replace(/e/g, 'ê'); const w = b.text.replace(/<\/?\d+>/g, '').split(/\s+/); const caps = b.text === b.text.toUpperCase(); let ex = w.slice(0, Math.ceil(w.length * 0.3)).join(' '); if (!caps) ex = ex.toLowerCase(); return [b.id, w.length > 1 ? t + ' ' + ex : t]; })),
      };
      const r = await translatePageWithLayout(doc, p, tr, undefined, { ocrFigures: false });
      const fr = new FileReader(); const url: string = await new Promise(ok => { fr.onload = () => ok(fr.result as string); fr.readAsDataURL(r.blob); });
      res['p' + p] = { img: url, ov: r.overflowCount };
    }
  } catch (e: any) { res.err = String(e?.stack || e); }
  res.gr = (globalThis as any).__GR; res.pl = (globalThis as any).__PL; (window as any).RESULT = JSON.stringify(res);
})();
