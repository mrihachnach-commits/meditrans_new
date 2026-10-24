import * as pdfjs from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';

export interface DocBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'header' | 'footer' | 'caption' | 'other';
  text: string;
  x: number;
  y: number; // PDF.js coordinate: 0 is bottom
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  bold: boolean;
  translatedText?: string;
}

interface TextItem {
  str: string;
  transform: number[]; // [scaleX, rotateX, rotateY, scaleY, x, y]
  width: number;
  height: number;
  fontName: string;
}

// Global cache for TTF fonts to avoid downloading them multiple times
let regularFontBytes: Uint8Array | null = null;
let boldFontBytes: Uint8Array | null = null;

const REGULAR_FONT_URLS = [
  'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto-Regular.ttf',
  'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/latin-400-normal.ttf',
  'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf'
];

const BOLD_FONT_URLS = [
  'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto-Bold.ttf',
  'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/latin-700-normal.ttf',
  'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Medium.ttf'
];

/**
 * Downloads a TrueType Font (.ttf) from CDN with failover mirrors to support Vietnamese accents.
 */
async function loadFontBytes(bold = false): Promise<Uint8Array> {
  if (bold && boldFontBytes) return boldFontBytes;
  if (!bold && regularFontBytes) return regularFontBytes;

  const urls = bold ? BOLD_FONT_URLS : REGULAR_FONT_URLS;
  let lastError: any = null;

  for (const url of urls) {
    try {
      console.log(`[PDF Reconstructor] Trying font mirror: ${url}`);
      const res = await fetch(url, { cache: 'force-cache' });
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (bold) {
          boldFontBytes = bytes;
        } else {
          regularFontBytes = bytes;
        }
        return bytes;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[PDF Reconstructor] Mirror failed (${url}):`, err);
    }
  }

  throw new Error(`Không thể tải font chữ tiếng Việt: ${lastError?.message || 'Tất cả mirrors đều lỗi'}`);
}

/**
 * Extracts raw PDF.js text items and groups them into logical lines and then paragraphs/blocks.
 */
export async function extractLayoutBlocks(
  pdfDoc: pdfjs.PDFDocumentProxy,
  pageNumber: number
): Promise<{ blocks: DocBlock[]; width: number; height: number }> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  const textContent = await page.getTextContent();
  const items = (textContent.items as any[]) as TextItem[];

  // 1. Filter and clean items
  const cleanItems = items
    .filter((item) => item.str && item.str.trim() !== '')
    .map((item) => {
      const transform = item.transform;
      const fontSize = Math.abs(transform[3]) || 12;
      const isBold = (item.fontName || '').toLowerCase().includes('bold') || (item.fontName || '').toLowerCase().includes('g_d0_f2');
      return {
        text: item.str,
        x: transform[4],
        y: transform[5],
        width: item.width || (item.str.length * fontSize * 0.5),
        height: item.height || fontSize,
        fontSize,
        fontName: item.fontName || 'Helvetica',
        bold: isBold,
      };
    });

  if (cleanItems.length === 0) {
    page.cleanup();
    return { blocks: [], width: pageWidth, height: pageHeight };
  }

  // 2. Sort items: primarily Y descending (top-to-bottom), secondarily X ascending (left-to-right)
  cleanItems.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 4) {
      return b.y - a.y; // Top first
    }
    return a.x - b.x; // Left first
  });

  // 3. Group items into lines
  const lines: any[] = [];
  let currentLine: any[] = [];

  cleanItems.forEach((item) => {
    if (currentLine.length === 0) {
      currentLine.push(item);
    } else {
      const firstInLine = currentLine[0];
      // Check if item is on the same horizontal line (within 4 points vertical gap)
      if (Math.abs(item.y - firstInLine.y) <= 4) {
        currentLine.push(item);
      } else {
        lines.push(currentLine);
        currentLine = [item];
      }
    }
  });
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  // Process and sort each line horizontally, merge closely spaced words
  const processedLines = lines.map((lineItems) => {
    lineItems.sort((a, b) => a.x - b.x);
    
    // Merge overlapping/closely spaced text segments
    let mergedText = '';
    let minX = lineItems[0].x;
    let maxX = lineItems[0].x + lineItems[0].width;
    let maxFontSize = lineItems[0].fontSize;
    let isBold = lineItems.some(item => item.bold);
    let fontName = lineItems[0].fontName;

    lineItems.forEach((item, index) => {
      if (index === 0) {
        mergedText = item.text;
      } else {
        const prevItem = lineItems[index - 1];
        const gap = item.x - (prevItem.x + prevItem.width);
        
        // Add space if there is a substantial horizontal gap
        if (gap > item.fontSize * 0.18) {
          mergedText += ' ' + item.text;
        } else {
          mergedText += item.text;
        }
        
        maxX = Math.max(maxX, item.x + item.width);
        maxFontSize = Math.max(maxFontSize, item.fontSize);
      }
    });

    return {
      text: mergedText,
      x: minX,
      y: lineItems[0].y,
      width: Math.max(maxX - minX, 10),
      height: maxFontSize,
      fontSize: maxFontSize,
      bold: isBold,
      fontName,
    };
  });

  // 4. Group lines into blocks (Paragraphs / Headings / Headers / Footers)
  const blocks: DocBlock[] = [];
  let currentBlockLines: any[] = [];

  processedLines.forEach((line) => {
    if (currentBlockLines.length === 0) {
      currentBlockLines.push(line);
    } else {
      const prevLine = currentBlockLines[currentBlockLines.length - 1];
      
      // Calculate vertical gap between lines
      const verticalGap = prevLine.y - line.y;
      
      // Determine if they belong to the same paragraph block
      const sameBlock =
        verticalGap < prevLine.fontSize * 2.6 &&
        Math.abs(line.fontSize - prevLine.fontSize) <= 2.5 &&
        Math.abs(line.x - prevLine.x) < pageWidth * 0.3;

      if (sameBlock) {
        currentBlockLines.push(line);
      } else {
        blocks.push(buildBlockFromLines(currentBlockLines, pageWidth, pageHeight, blocks.length + 1));
        currentBlockLines = [line];
      }
    }
  });

  if (currentBlockLines.length > 0) {
    blocks.push(buildBlockFromLines(currentBlockLines, pageWidth, pageHeight, blocks.length + 1));
  }

  page.cleanup();
  return { blocks, width: pageWidth, height: pageHeight };
}

function buildBlockFromLines(lines: any[], pageWidth: number, pageHeight: number, index: number): DocBlock {
  // Sort lines from top to bottom
  lines.sort((a, b) => b.y - a.y);

  const combinedText = lines.map((l) => l.text).join(' ');
  const minX = Math.min(...lines.map((l) => l.x));
  const maxX = Math.max(...lines.map((l) => l.x + l.width));
  const minY = Math.min(...lines.map((l) => l.y));
  const maxY = Math.max(...lines.map((l) => l.y));
  
  const highestFontSize = Math.max(...lines.map((l) => l.fontSize));
  const height = (maxY + highestFontSize) - minY;
  const width = maxX - minX;

  const averageFontSize = lines.reduce((acc, l) => acc + l.fontSize, 0) / lines.length;
  const isBold = lines.some((l) => l.bold);
  const fontName = lines[0].fontName;

  // Determine type
  let type: 'heading' | 'paragraph' | 'header' | 'footer' | 'caption' | 'other' = 'paragraph';

  const isAtTop = minY > pageHeight * 0.90;
  const isAtBottom = maxY + height < pageHeight * 0.08;

  if (isAtTop && lines.length === 1 && combinedText.length < 60) {
    type = 'header';
  } else if (isAtBottom && lines.length === 1 && combinedText.length < 40) {
    type = 'footer';
  } else if (averageFontSize > 13 || (isBold && lines.length === 1 && combinedText.length < 80)) {
    type = 'heading';
  } else if (averageFontSize < 10 && (combinedText.toLowerCase().includes('figure') || combinedText.toLowerCase().includes('hình'))) {
    type = 'caption';
  }

  return {
    id: `b${index}`,
    type,
    text: combinedText,
    x: minX,
    y: minY,
    width: Math.max(width, 15),
    height: Math.max(height, 10),
    fontSize: averageFontSize,
    fontName,
    bold: isBold,
  };
}

/**
 * Split text into wrapped lines that fit within a maximum width.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number, fontBold = false): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  if (words.length === 0) return [];

  const avgCharWidth = (fontBold ? 0.58 : 0.51) * fontSize;
  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine + ' ' + word;
    const testLineWidth = testLine.length * avgCharWidth;

    if (testLineWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

/**
 * Reconstructs a single PDF page with translated text using pdf-lib.
 * Covers original text blocks with white/background color and draws translated Vietnamese text.
 */
export async function reconstructPageInDocument(
  pdfDoc: PDFDocument,
  pageIndex: number,
  translatedBlocks: DocBlock[]
): Promise<void> {
  const pages = pdfDoc.getPages();
  if (pageIndex < 0 || pageIndex >= pages.length) return;
  const page = pages[pageIndex];

  // 1. Download and embed Vietnamese-ready TTF fonts
  const regularBytes = await loadFontBytes(false);
  const boldBytes = await loadFontBytes(true);

  const customRegularFont = await pdfDoc.embedFont(regularBytes);
  const customBoldFont = await pdfDoc.embedFont(boldBytes);

  for (const block of translatedBlocks) {
    const textToDraw = block.translatedText || block.text;
    if (!textToDraw || textToDraw.trim() === '') continue;

    // 2. White-out original text block region
    const pad = 2;
    page.drawRectangle({
      x: block.x - pad,
      y: block.y - pad,
      width: block.width + pad * 2,
      height: block.height + pad * 2,
      color: rgb(1, 1, 1), // White cover-up
    });

    // 3. Select correct font size and style
    const font = block.bold ? customBoldFont : customRegularFont;
    
    let drawFontSize = block.fontSize;
    if (drawFontSize > 24) drawFontSize = drawFontSize * 0.88;
    else if (drawFontSize > 12) drawFontSize = drawFontSize * 0.94;
    
    if (drawFontSize < 6) drawFontSize = 6;

    // 4. Wrap text into lines that fit the original block's width
    const maxDrawWidth = Math.max(block.width, 40);
    const wrappedLines = wrapText(textToDraw, maxDrawWidth, drawFontSize, block.bold);

    // 5. Draw each wrapped line within the block bounding box
    const lineHeight = drawFontSize * 1.18;
    let currentY = block.y + block.height - drawFontSize;

    for (let i = 0; i < wrappedLines.length; i++) {
      const lineText = wrappedLines[i];
      
      if (i > 0 && currentY < block.y - drawFontSize * 0.5) {
        break;
      }

      page.drawText(lineText, {
        x: block.x,
        y: currentY,
        size: drawFontSize,
        font: font,
        color: rgb(0.12, 0.12, 0.12),
      });

      currentY -= lineHeight;
    }
  }
}

/**
 * Overlays translated blocks onto an HTML5 Canvas for live viewing in the browser.
 */
export function renderTranslatedBlocksToCanvas(
  ctx: CanvasRenderingContext2D,
  blocks: DocBlock[],
  scale: number,
  pageHeight: number
) {
  ctx.save();

  for (const block of blocks) {
    const textToDraw = block.translatedText || block.text;
    if (!textToDraw || textToDraw.trim() === '') continue;

    // Canvas coordinates: y=0 is top, PDF coordinates: y=0 is bottom
    // PDF to Canvas Y conversion: canvasY = (pageHeight - (block.y + block.height)) * scale
    const canvasX = block.x * scale;
    const canvasY = (pageHeight - (block.y + block.height)) * scale;
    const canvasW = block.width * scale;
    const canvasH = block.height * scale;

    // 1. Wipe out background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(canvasX - 2, canvasY - 2, canvasW + 4, canvasH + 4);

    // 2. Draw text
    let fontSizePx = block.fontSize * scale;
    if (fontSizePx > 24 * scale) fontSizePx *= 0.88;
    else if (fontSizePx > 12 * scale) fontSizePx *= 0.94;
    fontSizePx = Math.max(fontSizePx, 7);

    ctx.font = `${block.bold ? 'bold ' : ''}${fontSizePx}px 'Inter', sans-serif`;
    ctx.fillStyle = '#1e293b';
    ctx.textBaseline = 'top';

    const wrappedLines = wrapText(textToDraw, canvasW, fontSizePx, block.bold);
    const lineHeight = fontSizePx * 1.2;
    let lineY = canvasY;

    for (const line of wrappedLines) {
      if (lineY + fontSizePx > canvasY + canvasH + lineHeight) break;
      ctx.fillText(line, canvasX, lineY);
      lineY += lineHeight;
    }
  }

  ctx.restore();
}
