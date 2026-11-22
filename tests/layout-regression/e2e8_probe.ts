import * as pdfjs from '/tmp/v77/node_modules/pdfjs-dist/build/pdf.js';
import { translatePageWithLayout } from '/tmp/v77/src/services/layoutTranslationService';
(pdfjs as any).GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
const Q = new URLSearchParams(location.search);
const PAGES: number[] = (Q.get('pages') || '1').split(',').map(Number);
const PDF = Q.get('pdf') || 'nb.pdf';
const IMG = Q.get('img') === '1';
const res: any = { pages: {} };
const VI = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
(async () => {
  try {
    const ff = new FontFace('Tinos', 'url(Tinos-Regular.ttf)'); await ff.load(); (document as any).fonts.add(ff);
    const doc = await (pdfjs as any).getDocument({ url: PDF }).promise;
    res.numPages = doc.numPages;
    for (const p of PAGES) {
      if (p > doc.numPages) continue;
      const t0 = performance.now();
      (globalThis as any).__LAYOUT_PROBE = [];
      try {
        const tr: any = {
          translateLayoutBlocks: async (blocks: any[]) => Object.fromEntries(blocks.map(b => {
            if (VI.test(b.text)) return [b.id, b.text];
            const t = b.text.replace(/a/g, 'ă').replace(/e/g, 'ê'); const w = b.text.replace(/<\/?\d+>/g, '').split(/\s+/); const caps = b.text === b.text.toUpperCase();
            let ex = w.slice(0, Math.ceil(w.length * 0.3)).join(' '); if (!caps) ex = ex.toLowerCase(); return [b.id, w.length > 1 ? t + ' ' + ex : t];
          })),
        };
        const r = await translatePageWithLayout(doc, p, tr, undefined, { ocrFigures: false });
        const pr = (globalThis as any).__LAYOUT_PROBE;
        const o: any = { scanned: r.scanned, blank: r.blank, ov: r.overflowCount, blocks: r.blockCount, probe: pr[pr.length - 1] || null, ms: Math.round(performance.now() - t0) };
        if (IMG) { const fr = new FileReader(); o.img = await new Promise(ok => { fr.onload = () => ok(fr.result as string); fr.readAsDataURL(r.blob); }); }
        res.pages[p] = o;
      } catch (e: any) { res.pages[p] = { err: String(e?.message || e).slice(0, 300) }; }
    }
  } catch (e: any) { res.err = String(e?.stack || e); }
  (window as any).RESULT = JSON.stringify(res);
})();
