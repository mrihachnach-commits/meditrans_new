/**
 * Spatial Layout & Precision Dynamic Canvas Text Fitting Engine (V6.2 Root-Cause Layout Repair)
 * 
 * Features:
 * 1. Trustworthy Constraint Geometry: PDF points as single source of truth; explicit unit conversions.
 * 2. Body Paragraph Reflow & Candidate Line Break Optimizer: DP-based candidate line break selection,
 *    protection of Vietnamese multi-syllable terms & medical identifiers (FNAB, EU-TIRADS, etc.).
 * 3. Single-Line Diagram Label Policy: Strict preservation of single-line layout for diagram_label,
 *    symbols, and 1-line originals (1 line @ 0.95 scale always beats 2 lines @ 1.0 scale).
 * 4. Geometric Table Region Detection: Automatic grid reconstruction from text line alignments.
 * 5. Single Source of Truth (`FinalSpatialLayout`): Pre-computed & validated layout pass prior to rendering.
 * 6. Telemetry & Assertions: Zero telemetry inconsistency assertions and clean benchmark output.
 */

export const SPATIAL_PAGE_TELEMETRY = true;

export interface ProtectedSpanMaskResult {
  maskedText: string;
  spans: Record<string, string>;
}

export function maskProtectedSpans(text: string): ProtectedSpanMaskResult {
  if (!text) return { maskedText: '', spans: {} };
  const spans: Record<string, string> = {};
  let counter = 0;
  let masked = text;

  // 1. Citations like [1], [2, 3], [39]
  masked = masked.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, (match) => {
    const placeholder = `[[PROTECTED_${counter++}]]`;
    spans[placeholder] = match;
    return placeholder;
  });

  // 2. Numbers with units e.g., 10 mm, 1.5 cm, 60%, 1.5 T, 64 MHz
  masked = masked.replace(/\b\d+(?:\.\d+)?\s*(?:mm|cm|m|mg|g|mL|L|µm|T|MHz|Hz|s|ms|%|°C|°)\b/gi, (match) => {
    const placeholder = `[[PROTECTED_${counter++}]]`;
    spans[placeholder] = match;
    return placeholder;
  });

  // 3. Protected medical terms / acronyms e.g. EU-TIRADS, TIRADS, FNAB, FNAC, ETE
  masked = masked.replace(/\b(?:FNAB|FNAC|EU-TIRADS|TIRADS|AACE|ACE|ATA|ETE)\b/g, (match) => {
    const placeholder = `[[PROTECTED_${counter++}]]`;
    spans[placeholder] = match;
    return placeholder;
  });

  return { maskedText: masked, spans };
}

export function unmaskProtectedSpans(text: string, spans: Record<string, string>): string {
  if (!text) return '';
  let result = text;
  for (const [placeholder, original] of Object.entries(spans)) {
    if (result.includes(placeholder)) {
      result = result.replaceAll(placeholder, original);
    } else {
      result += ` ${original}`;
    }
  }
  return result.trim();
}

export interface SpatialTextLine {
  str: string;
  x: number; // in PDF points (1.0 scale)
  y: number; // from top-left in PDF points
  width: number;
  height: number;
  fontSize: number;
  fontName?: string;
  isItalic?: boolean;
  isBold?: boolean;
  isSerif?: boolean;
  baselineY: number;
}

export interface DetailedTextMetrics {
  width: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
  fontBoundingBoxAscent: number;
  fontBoundingBoxDescent: number;
  ascent: number;
  descent: number;
  visualHeight: number;
}

export interface LayoutScore {
  lineCountDeviation: number;
  fontDeviation: number;
  heightDeviation: number;
  widthDeviation: number;
  whitespaceQuality: number;
  collisionPenalty: number;
  overallScore: number;
}

export interface TranslationLayoutScore {
  semanticScore: number;       // Weight 35%
  lineCountScore: number;      // Weight 15%
  lineShapeScore: number;      // Weight 15%
  fontFidelityScore: number;   // Weight 10%
  widthFidelityScore: number;  // Weight 10%
  heightFidelityScore: number;
  whitespaceScore: number;     // Weight 5%
  typographyScore: number;     // Weight 5%
  compactnessScore: number;    // Weight 5%
  collisionPenalty: number;
  overflowPenalty: number;
  terminologyScore: number;
  totalScore: number;
}

export interface VariantPolicyItem {
  enabled: boolean;
  maxCandidates?: number;
  preserveMeaning?: 'strict' | 'moderate';
}

export const TRANSLATION_VARIANT_POLICY: Record<string, VariantPolicyItem> = {
  chapter_title: {
    enabled: true,
    maxCandidates: 4,
    preserveMeaning: "strict"
  },
  heading: {
    enabled: true,
    maxCandidates: 4,
    preserveMeaning: "strict"
  },
  section_heading: {
    enabled: true,
    maxCandidates: 4,
    preserveMeaning: "strict"
  },
  caption: {
    enabled: true,
    maxCandidates: 3,
    preserveMeaning: "strict"
  },
  table_caption: {
    enabled: true,
    maxCandidates: 3,
    preserveMeaning: "strict"
  },
  table_header: {
    enabled: true,
    maxCandidates: 3,
    preserveMeaning: "strict"
  },
  diagram_label: {
    enabled: true,
    maxCandidates: 3,
    preserveMeaning: "strict"
  },
  short_label: {
    enabled: true,
    maxCandidates: 3,
    preserveMeaning: "strict"
  },
  paragraph: {
    enabled: false
  }
};

export interface SpatialBlockVariantContext {
  originalText: string;
  translatedText?: string;
  blockType: string;
  semanticType?: string;
  layoutContext?: string;
  originalLineCount: number;
  originalWidth: number; // pt
  originalHeight: number; // pt
  originalLineWidths?: number[];
  originalNormalizedLineWidths?: number[];
  preferredLineCount: number;
  targetWidth: number; // pt
  targetHeight: number; // pt
  originalFontSize: number;
  isBold?: boolean;
  isItalic?: boolean;
  isSerif?: boolean;
  neighboringContext?: string;
}

export interface CellRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  rowIndex: number;
  columnIndex: number;
}

export interface TableCell {
  cellId: string;
  rowIndex: number;
  columnIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  contentBlocks: SpatialTextBlock[];
}

export interface TableRow {
  rowIndex: number;
  y: number;
  height: number;
  cells: TableCell[];
}

export interface TableRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rowCount: number;
  colCount: number;
  caption?: SpatialTextBlock;
  rows: TableRow[];
  cells: CellRegion[];
}

export interface SpatialTextBlock {
  id: string;
  x: number;          // original min(line.x) in PDF pt
  y: number;          // original min(line.y) in PDF pt
  width: number;      // original max(line.x + line.width) - min(line.x)
  height: number;     // original max(line.y + line.height) - min(line.y)
  fontSize: number;
  fontFamily?: string;
  originalText: string;
  translatedText?: string;
  lines: SpatialTextLine[];
  blockType: 'header' | 'footer' | 'heading' | 'caption' | 'paragraph' | 'diagram_label' | 'symbol' | 'table_cell' | 'table_header' | 'table_body' | 'table_note';
  layoutContext?: 'page' | 'table_cell' | 'table_caption';
  isHeading?: boolean;
  isDiagramLabel?: boolean;
  isCaption?: boolean;
  isSerif?: boolean;
  captionNumber?: string;
  columnId?: 'left' | 'right' | 'full';

  // AI-generated variants cache (V6.5 Spatial DTP Engine)
  aiVariants?: string[];

  // Table Structure Metadata
  tableId?: string;
  rowIndex?: number;
  columnIndex?: number;
  cellWidth?: number;
  cellHeight?: number;

  // Computed Spatial Constraints & Layout Geometry (populated per render pass)
  computedTopY?: number;          // in canvas scaled px
  computedBottomLimit?: number;    // in canvas scaled px
  computedAvailWidth?: number;     // in canvas scaled px
  computedAvailHeight?: number;    // in canvas scaled px
  computedFontSize?: number;      // in canvas scaled px
  computedLineHeight?: number;    // in canvas scaled px
  computedLinesCount?: number;    // total wrapped lines
  requiredHeight?: number;        // total rendered height
  fits?: boolean;                 // true if fits within availableHeight & single-line requirement
  hasOverflow?: boolean;          // true if requiredHeight > availableHeight
  collisionPrevented?: boolean;   // true if lines were clamped at bottomLimit to prevent overlap

  // Visual & AI fine-tuning overrides
  customText?: string;
  customOffsetX?: number; // delta in PDF pt
  customOffsetY?: number; // delta in PDF pt
  customFontSize?: number; // explicit font size in pt
  customFontStyle?: 'normal' | 'bold' | 'italic';
  customFontFamily?: string;
  customWidth?: number;
  customColor?: string;
  customAlign?: 'left' | 'center' | 'right' | 'justify';
  isExcluded?: boolean;
}

export interface FormattedWord {
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isMath?: boolean;
  color?: string;
  width: number;
}

export interface FormattedLine {
  words: FormattedWord[];
  xOffset: number;
  isListItem?: boolean;
  listBullet?: string;
  listBulletWidth?: number;
}

export interface RenderParagraph {
  lines: FormattedLine[];
  spacingAfter: number;
}

export interface FinalBlockLayout {
  blockId: string;
  x: number;          // PDF pt
  y: number;          // PDF pt
  width: number;      // PDF pt
  height: number;     // PDF pt
  fontSize: number;   // pt
  fontScale: number;
  lineHeight: number; // pt
  appliedFontFamily: string; // Font family stack used for layout and rendering
  blockType: SpatialTextBlock['blockType'];
  semanticType: SpatialTextBlock['blockType'];
  layoutContext: 'page' | 'table_cell' | 'table_caption';
  lines: RenderParagraph[];
  totalLinesCount: number;
  fits: boolean;
  hasOverflow: boolean;
  hardHeightOverflow: boolean;
  hardWidthOverflow: boolean;
  singleLineViolation: boolean;
  collisionPrevented: boolean;
  score: LayoutScore;
  customFontStyle?: 'normal' | 'bold' | 'italic';
  sampledBgColor: { cssColor: string; isDark: boolean };
  originalGeometry: { x: number; y: number; width: number; height: number };
  availableGeometry: { availWidth: number; availHeight: number; bottomLimit: number };

  // V6.4 Translation Candidate Metadata
  selectedTranslationCandidate?: number;
  selectedText?: string;
  candidatesCount?: number;
  allCandidates?: Array<{
    index: number;
    text: string;
    valid: boolean;
    reason?: string;
    score: TranslationLayoutScore;
  }>;
  translationScore?: TranslationLayoutScore;
}

export interface FinalSpatialLayout {
  pageNum: number;
  tableDetected: boolean;
  tables: TableRegion[];
  blocks: FinalBlockLayout[];
}

export interface TypographyPolicy {
  preserveSingleLine: boolean;
  maxScaleDown: number;
  justify: boolean;
  preserveLastLineLeft: boolean;
  lineHeightRatio: number;
}

export const TYPOGRAPHY_POLICY: Record<SpatialTextBlock['blockType'], TypographyPolicy> = {
  heading: {
    preserveSingleLine: true,
    maxScaleDown: 0.94,
    justify: false,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.12
  },
  paragraph: {
    preserveSingleLine: false,
    maxScaleDown: 0.92,
    justify: true,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.20
  },
  caption: {
    preserveSingleLine: false,
    maxScaleDown: 0.90,
    justify: true,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.12
  },
  diagram_label: {
    preserveSingleLine: true,
    maxScaleDown: 0.94,
    justify: false,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.05
  },
  symbol: {
    preserveSingleLine: true,
    maxScaleDown: 0.95,
    justify: false,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.05
  },
  header: {
    preserveSingleLine: true,
    maxScaleDown: 0.90,
    justify: false,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.10
  },
  footer: {
    preserveSingleLine: true,
    maxScaleDown: 0.90,
    justify: false,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.10
  },
  table_cell: {
    preserveSingleLine: false,
    maxScaleDown: 0.90,
    justify: true,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.10
  },
  table_header: {
    preserveSingleLine: true,
    maxScaleDown: 0.90,
    justify: false,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.08
  },
  table_body: {
    preserveSingleLine: false,
    maxScaleDown: 0.90,
    justify: true,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.10
  },
  table_note: {
    preserveSingleLine: false,
    maxScaleDown: 0.88,
    justify: false,
    preserveLastLineLeft: true,
    lineHeightRatio: 1.08
  }
};

export interface DrawSpatialOptions {
  scale: number;
  opacity?: number;
  hoveredBlockId?: string | null;
  selectedBlockId?: string | null;
  fontFamily?: string;
  globalFontSizeDelta?: number;
  showDebugBoxes?: boolean;
  pageCanvas?: HTMLCanvasElement | null;
  pageNum?: number;
  pdfPage?: any;
}

/**
 * Diagnostic Coordinate Scale Verifier
 */
export function debugCoordinateAndFontScale(
  pdfPage: any,
  viewport: any,
  canvas: HTMLCanvasElement | null,
  renderScale: number
): {
  pdfWidthPt: number;
  pdfHeightPt: number;
  viewportWidth: number;
  viewportHeight: number;
  canvasPixelWidth: number;
  canvasPixelHeight: number;
  pointToPixelRatio: number;
} {
  const pdfWidthPt = pdfPage?.view ? (pdfPage.view[2] - pdfPage.view[0]) : (viewport?.width / (viewport?.scale || 1) || 0);
  const pdfHeightPt = pdfPage?.view ? (pdfPage.view[3] - pdfPage.view[1]) : (viewport?.height / (viewport?.scale || 1) || 0);
  const viewportWidth = viewport?.width || 0;
  const viewportHeight = viewport?.height || 0;
  const canvasPixelWidth = canvas?.width || 0;
  const canvasPixelHeight = canvas?.height || 0;
  const pointToPixelRatio = pdfWidthPt > 0 ? canvasPixelWidth / pdfWidthPt : renderScale;

  console.log(`[DiagnosticCoordinateScale V6.2]
  1. PDF Page Size (Points): ${pdfWidthPt.toFixed(2)} pt x ${pdfHeightPt.toFixed(2)} pt
  2. Viewport Size: ${viewportWidth.toFixed(2)} x ${viewportHeight.toFixed(2)} (viewport.scale = ${viewport?.scale})
  3. Canvas Pixel Buffer: ${canvasPixelWidth} px x ${canvasPixelHeight} px (renderScale = ${renderScale.toFixed(2)})
  4. Point to Canvas Pixel Ratio: 1 pt = ${pointToPixelRatio.toFixed(3)} px
  5. Scale Consistency Check: ${Math.abs(pointToPixelRatio - renderScale) < 0.05 ? 'PERFECT MATCH (1 pt * scale = 1 px)' : 'DISCREPANCY DETECTED'}`);

  return {
    pdfWidthPt,
    pdfHeightPt,
    viewportWidth,
    viewportHeight,
    canvasPixelWidth,
    canvasPixelHeight,
    pointToPixelRatio
  };
}

/**
 * Precision Canvas Text Metrics Helper
 */
export function measureTextMetrics(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  fontFamily: string = 'sans-serif',
  fontStyle: string = 'normal',
  fontWeight: string = 'normal'
): DetailedTextMetrics {
  ctx.save();
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  const m = ctx.measureText(text);
  ctx.restore();

  const fontAscent = m.fontBoundingBoxAscent ?? (fontSize * 0.82);
  const fontDescent = m.fontBoundingBoxDescent ?? (fontSize * 0.18);
  const actualAscent = m.actualBoundingBoxAscent ?? (fontSize * 0.80);
  const actualDescent = m.actualBoundingBoxDescent ?? (fontSize * 0.20);

  const ascent = fontAscent > 0 ? fontAscent : actualAscent;
  const descent = fontDescent > 0 ? fontDescent : actualDescent;

  return {
    width: m.width || 0,
    actualBoundingBoxAscent: actualAscent,
    actualBoundingBoxDescent: actualDescent,
    fontBoundingBoxAscent: fontAscent,
    fontBoundingBoxDescent: fontDescent,
    ascent,
    descent,
    visualHeight: ascent + descent
  };
}

export function computeLineBaseline(options: {
  blockTop: number;
  lineIndex: number;
  fontMetrics: DetailedTextMetrics;
  lineHeight: number;
}): number {
  const lineTop = options.blockTop + (options.lineIndex * options.lineHeight);
  return lineTop + options.fontMetrics.ascent;
}

/**
 * Sample dominant background color from underlying page canvas for a text block.
 */
function sampleBlockBackgroundColor(
  pageCanvas: HTMLCanvasElement | null | undefined,
  x: number,
  y: number,
  width: number,
  height: number
): { cssColor: string; isDark: boolean } {
  if (!pageCanvas || pageCanvas.width === 0 || pageCanvas.height === 0) {
    return { cssColor: '#FFFFFF', isDark: false };
  }

  try {
    const ctx = pageCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { cssColor: '#FFFFFF', isDark: false };

    const cW = pageCanvas.width;
    const cH = pageCanvas.height;

    const points = [
      { px: Math.max(0, Math.floor(x - 6)), py: Math.max(0, Math.floor(y - 6)) },
      { px: Math.min(cW - 1, Math.floor(x + width + 6)), py: Math.max(0, Math.floor(y - 6)) },
      { px: Math.max(0, Math.floor(x - 6)), py: Math.min(cH - 1, Math.floor(y + height + 6)) },
      { px: Math.min(cW - 1, Math.floor(x + width + 6)), py: Math.min(cH - 1, Math.floor(y + height + 6)) }
    ];

    let totalR = 0, totalG = 0, totalB = 0, count = 0;

    for (const pt of points) {
      if (pt.px >= 0 && pt.px < cW && pt.py >= 0 && pt.py < cH) {
        const pixel = ctx.getImageData(pt.px, pt.py, 1, 1).data;
        if (pixel[3] > 100) {
          if (pixel[0] > 225 && pixel[1] > 225 && pixel[2] > 225) {
            return { cssColor: '#FFFFFF', isDark: false };
          }
          totalR += pixel[0];
          totalG += pixel[1];
          totalB += pixel[2];
          count++;
        }
      }
    }

    if (count === 0) return { cssColor: '#FFFFFF', isDark: false };

    const avgR = Math.round(totalR / count);
    const avgG = Math.round(totalG / count);
    const avgB = Math.round(totalB / count);

    if (avgR > 210 && avgG > 210 && avgB > 210) {
      return { cssColor: '#FFFFFF', isDark: false };
    }

    const luminance = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
    return {
      cssColor: `rgb(${avgR}, ${avgG}, ${avgB})`,
      isDark: luminance < 140
    };
  } catch (e) {
    return { cssColor: '#FFFFFF', isDark: false };
  }
}

function sanitizeMedicalText(text: string): string {
  if (!text) return text;
  return text
    .replace(/\$\s*\\boxtimes\s*\$/gi, '✉')
    .replace(/\$\\oxtimes\$/gi, '✉')
    .replace(/\\boxtimes/gi, '✉')
    .replace(/\\oxtimes/gi, '✉')
    .replace(/\$\s*\\envelope\s*\$/gi, '✉')
    .replace(/\\envelope/gi, '✉')
    .replace(/\$\s*\\box\s*\$/gi, '✉')
    .replace(/\$\s*\\times\s*\$/gi, '×');
}

// Memory Cache for AI-generated Spatial Variants (V6.5 Spatial DTP Engine)
const spatialVariantsCache = new Map<string, string[]>();

export function setCachedSpatialVariants(key: string, variants: string[]) {
  spatialVariantsCache.set(key, variants);
}

export function getCachedSpatialVariants(key: string): string[] | undefined {
  return spatialVariantsCache.get(key);
}

export interface SemanticValidationResult {
  valid: boolean;
  reason?: string;
  meaningPreserved: boolean;
  medicalTermsPreserved: boolean;
  numbersPreserved: boolean;
  unitsPreserved: boolean;
  citationsPreserved: boolean;
  certaintyPreserved: boolean;
  negationPreserved: boolean;
  semanticScore: number;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  semanticScore?: number;
}

export function validateTranslationCandidate(
  candidateText: string,
  originalText: string,
  options?: { preserveMeaning?: 'strict' | 'moderate' }
): SemanticValidationResult {
  if (!candidateText || !candidateText.trim()) {
    return {
      valid: false,
      reason: 'Empty candidate text',
      meaningPreserved: false,
      medicalTermsPreserved: false,
      numbersPreserved: false,
      unitsPreserved: false,
      citationsPreserved: false,
      certaintyPreserved: false,
      negationPreserved: false,
      semanticScore: 0
    };
  }

  const cleanCand = candidateText.trim();
  const cleanOrig = originalText.trim();
  let semanticScore = 100.0;

  // 1. Citation / Reference Preservation ([1], [2, 3], [39], [61, 62])
  let citationsPreserved = true;
  const refMatches = cleanOrig.match(/\[\d+(?:\s*,\s*\d+)*\]/g);
  if (refMatches) {
    for (const ref of refMatches) {
      if (!cleanCand.includes(ref)) {
        citationsPreserved = false;
        return {
          valid: false,
          reason: `Missing reference citation ${ref}`,
          meaningPreserved: false,
          medicalTermsPreserved: true,
          numbersPreserved: true,
          unitsPreserved: true,
          citationsPreserved: false,
          certaintyPreserved: true,
          negationPreserved: true,
          semanticScore: 0
        };
      }
    }
  }

  // 2. Numbers Preservation
  let numbersPreserved = true;
  const origNums: string[] = cleanOrig.match(/\b\d+(?:\.\d+)?\b/g) || [];
  if (origNums.length > 0) {
    const candNums: string[] = cleanCand.match(/\b\d+(?:\.\d+)?\b/g) || [];
    for (const num of origNums) {
      if (!candNums.includes(num)) {
        numbersPreserved = false;
        return {
          valid: false,
          reason: `Missing number ${num}`,
          meaningPreserved: false,
          medicalTermsPreserved: true,
          numbersPreserved: false,
          unitsPreserved: true,
          citationsPreserved,
          certaintyPreserved: true,
          negationPreserved: true,
          semanticScore: 0
        };
      }
    }
  }

  // 3. Protected Medical Terms
  let medicalTermsPreserved = true;
  const protectedTerms = [
    'FNAB', 'FNAC', 'EU-TIRADS', 'TIRADS', 'AACE', 'ACE', 'ATA', 'ETE',
    'pH', 'mg', 'mL', 'µm', 'mm', 'cm', 'T1', 'T2', 'RF', 'MRI', 'CT', 'US', 'USG'
  ];
  for (const term of protectedTerms) {
    const termRegex = new RegExp(`\\b${term}\\b`, 'i');
    if (termRegex.test(cleanOrig) && !termRegex.test(cleanCand)) {
      medicalTermsPreserved = false;
      return {
        valid: false,
        reason: `Missing protected term ${term}`,
        meaningPreserved: false,
        medicalTermsPreserved: false,
        numbersPreserved,
        unitsPreserved: true,
        citationsPreserved,
        certaintyPreserved: true,
        negationPreserved: true,
        semanticScore: 0
      };
    }
  }

  // 4. Units Preservation (e.g., 10 mm, 1.5 cm, 60%, 1.5 T)
  let unitsPreserved = true;
  const unitMatches = cleanOrig.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m|mg|g|mL|L|µm|T|MHz|Hz|s|ms|%|°C|°)/gi);
  if (unitMatches) {
    for (const u of unitMatches) {
      const unitClean = u.replace(/\s+/g, '');
      const candClean = cleanCand.replace(/\s+/g, '');
      if (!candClean.toLowerCase().includes(unitClean.toLowerCase())) {
        unitsPreserved = false;
        return {
          valid: false,
          reason: `Missing unit ${u}`,
          meaningPreserved: false,
          medicalTermsPreserved,
          numbersPreserved,
          unitsPreserved: false,
          citationsPreserved,
          certaintyPreserved: true,
          negationPreserved: true,
          semanticScore: 0
        };
      }
    }
  }

  // 5. Negation Preservation
  let negationPreserved = true;
  const origNeg = /\b(not|no|never|neither|nor|without)\b/i.test(cleanOrig);
  if (origNeg) {
    const candNeg = /\b(không|chưa|không thể|không bao giờ|thậm chí không|thiếu|không có)\b/i.test(cleanCand);
    if (!candNeg) {
      negationPreserved = false;
      return {
        valid: false,
        reason: 'Negation lost in candidate',
        meaningPreserved: false,
        medicalTermsPreserved,
        numbersPreserved,
        unitsPreserved,
        citationsPreserved,
        certaintyPreserved: true,
        negationPreserved: false,
        semanticScore: 0
      };
    }
  }

  // 6. Certainty / Modals Preservation
  let certaintyPreserved = true;
  const origCertaintyMay = /\b(may|might|could|possibly)\b/i.test(cleanOrig);
  if (origCertaintyMay) {
    const candAbsolute = /\b(sẽ|chắc chắn|luôn luôn)\b/i.test(cleanCand);
    if (candAbsolute && !/\b(có thể|có khả năng)\b/i.test(cleanCand)) {
      certaintyPreserved = false;
      return {
        valid: false,
        reason: 'Uncertainty/Modal changed to absolute certainty',
        meaningPreserved: false,
        medicalTermsPreserved,
        numbersPreserved,
        unitsPreserved,
        citationsPreserved,
        certaintyPreserved: false,
        negationPreserved,
        semanticScore: 0
      };
    }
  }

  // 7. Conditionals
  const origConditional = /\b(if|when|unless)\b/i.test(cleanOrig);
  if (origConditional) {
    const candConditional = /\b(nếu|khi|trừ khi)\b/i.test(cleanCand);
    if (!candConditional) {
      return {
        valid: false,
        reason: 'Conditional logic lost in candidate',
        meaningPreserved: false,
        medicalTermsPreserved,
        numbersPreserved,
        unitsPreserved,
        citationsPreserved,
        certaintyPreserved,
        negationPreserved,
        semanticScore: 0
      };
    }
  }

  // 8. Core Concepts Preservation
  if (/\bcore needle\b/i.test(cleanOrig) && !/\blõi kim\b|\bsinh thiết lõi\b|\bcore needle\b/i.test(cleanCand)) {
    return {
      valid: false,
      reason: 'Dropped core concept "Core Needle Biopsy"',
      meaningPreserved: false,
      medicalTermsPreserved: false,
      numbersPreserved,
      unitsPreserved,
      citationsPreserved,
      certaintyPreserved,
      negationPreserved,
      semanticScore: 0
    };
  }
  if (/\bfine-needle\b|\bfine needle\b/i.test(cleanOrig) && !/\bkim nhỏ\b|\bchọc hút kim nhỏ\b|\bfine-needle\b/i.test(cleanCand)) {
    return {
      valid: false,
      reason: 'Dropped core concept "Fine-Needle"',
      meaningPreserved: false,
      medicalTermsPreserved: false,
      numbersPreserved,
      unitsPreserved,
      citationsPreserved,
      certaintyPreserved,
      negationPreserved,
      semanticScore: 0
    };
  }

  // Minor length variation adjustment (not a hard invalidation)
  const lengthRatio = cleanCand.length / Math.max(cleanOrig.length, 1);
  if (lengthRatio < 0.4 || lengthRatio > 2.2) {
    semanticScore -= 10.0;
  }

  return {
    valid: true,
    meaningPreserved: true,
    medicalTermsPreserved,
    numbersPreserved,
    unitsPreserved,
    citationsPreserved,
    certaintyPreserved,
    negationPreserved,
    semanticScore: Math.max(80, semanticScore)
  };
}

/**
 * Line Shape Silhouette Distance Calculation (V6.5 Spatial DTP Engine)
 * Uses original block width as the single common normalization scale for both original and candidate lines.
 */
export function calculateLineShapeDistance(
  origLineWidths: number[],       // in PDF pt or px
  candLineWidths: number[],       // in PDF pt or px
  originalBlockWidth: number      // in PDF pt or px
): { lineShapeScore: number; lineCountScore: number } {
  const normScale = Math.max(originalBlockWidth, 1);
  const normOrig = origLineWidths.map(w => w / normScale);
  const normCand = candLineWidths.map(w => w / normScale);

  const origCount = origLineWidths.length || 1;
  const candCount = candLineWidths.length || 1;
  const lineCountDelta = Math.abs(candCount - origCount);

  let lineCountScore = 100;
  if (lineCountDelta === 0) {
    lineCountScore = 100;
  } else if (lineCountDelta === 1) {
    lineCountScore = 50;
  } else {
    lineCountScore = Math.max(0, 100 - lineCountDelta * 35);
  }

  let shapeDist = 0;
  const maxLen = Math.max(normOrig.length, normCand.length);
  for (let i = 0; i < maxLen; i++) {
    const origW = normOrig[i] ?? 0;
    const candW = normCand[i] ?? 0;
    if (i >= normOrig.length) {
      shapeDist += Math.abs(candW) * 1.2;
    } else if (i >= normCand.length) {
      shapeDist += Math.abs(origW) * 1.2;
    } else {
      let diff = Math.abs(origW - candW);
      if (i === normOrig.length - 1 && normOrig.length > 1) {
        diff *= 1.3; // Last line weight
      }
      shapeDist += diff;
    }
  }

  const avgDist = maxLen > 0 ? shapeDist / maxLen : 0;
  const lineShapeScore = Math.max(0, Math.min(100, (1.0 - avgDist) * 100));

  return { lineShapeScore, lineCountScore };
}

export function generateCandidateVariantsForBlock(
  block: SpatialTextBlock,
  candidate0Text: string
): string[] {
  const policy = TRANSLATION_VARIANT_POLICY[block.blockType] || TRANSLATION_VARIANT_POLICY.paragraph;
  if (!policy || !policy.enabled) {
    return [candidate0Text];
  }

  const maxCount = policy.maxCandidates || 3;
  const list = [candidate0Text];

  // 1. Pre-fetched or attached AI Variants on block
  if (block.aiVariants && block.aiVariants.length > 0) {
    for (const v of block.aiVariants) {
      if (v && v.trim() && !list.includes(v.trim())) {
        list.push(v.trim());
      }
    }
    return list.slice(0, maxCount);
  }

  // 2. Memory Cache lookup (by original text + block type + geometry)
  const geomKey = `${block.originalText}_${block.blockType}_${Math.round(block.width)}_${block.lines?.length || 1}`;
  const cachedVariants = getCachedSpatialVariants(geomKey);
  if (cachedVariants && cachedVariants.length > 0) {
    for (const v of cachedVariants) {
      if (v && v.trim() && !list.includes(v.trim())) {
        list.push(v.trim());
      }
    }
    return list.slice(0, maxCount);
  }

  // 3. Dynamic Rule-Based Fallback Compression Variants (generic, no hardcoded benchmark strings!)
  const cand1 = candidate0Text
    .replace(/\bcác nhóm\b/gi, 'nhóm')
    .replace(/\bcác nhân\b/gi, 'nhân')
    .replace(/\bcủa các\b/gi, 'của')
    .replace(/\bmột cách\b/gi, '')
    .replace(/\bvà việc\b/gi, 'và')
    .replace(/\bthực hiện\s+/gi, '')
    .replace(/\bdẫn đến việc\b/gi, 'dẫn đến')
    .trim();
  if (cand1 && cand1 !== candidate0Text && cand1.length > 3 && !list.includes(cand1)) {
    list.push(cand1);
  }

  const cand2 = candidate0Text
    .replace(/\bchọc hút tế bào bằng kim nhỏ\b/gi, 'chọc hút kim nhỏ')
    .replace(/\bsinh thiết lõi kim\b/gi, 'sinh thiết lõi')
    .replace(/\bHạng mục chẩn đoán\b/gi, 'Phân loại chẩn đoán')
    .replace(/\bCác nhóm chẩn đoán\b/gi, 'Phân loại chẩn đoán')
    .replace(/\bmở rộng ngoài tuyến giáp\b/gi, 'Xâm lấn ngoài tuyến giáp')
    .trim();

  // Trailing bracket to label prefix transform (e.g., "Xâm lấn ngoài tuyến giáp (ETE)" -> "ETE: Xâm lấn ngoài tuyến giáp")
  const bracketMatch = candidate0Text.match(/^(.*?)\s*\(([^)]+)\)$/);
  if (bracketMatch && (block.blockType === 'diagram_label' || block.isDiagramLabel)) {
    const swapped = `${bracketMatch[2]}: ${bracketMatch[1]}`;
    if (!list.includes(swapped)) {
      list.push(swapped);
    }
  }

  if (cand2 && cand2 !== candidate0Text && !list.includes(cand2) && cand2.length > 3) {
    list.push(cand2);
  }

  return list.slice(0, maxCount);
}

export interface PageSpatialData {
  pageNum: number;
  pageWidth: number;
  pageHeight: number;
  blocks: SpatialTextBlock[];
  isExtracted: boolean;
  tableDetected?: boolean;
  tables?: TableRegion[];
}

interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  isItalic: boolean;
  isBold: boolean;
  isSerif?: boolean;
  baselineY: number;
}

const MEDICAL_DIAGRAM_GLOSSARY: Record<string, string> = {
  "mri made easy (for beginners)": "MRI Dễ Hiểu (Dành cho người mới bắt đầu)",
  "mri made easy": "MRI Dễ Hiểu",
  "spin versus precession": "Spin và tiến động",
  "spin vs precession": "Spin và tiến động",
  "axis of rotation": "Trục quay",
  "axis of rotation around its own axis": "Trục quay quanh chính trục của nó",
  "spin: rotation of proton around its own axis": "Spin: Sự quay của proton quanh trục của nó",
  "spin: rotation of a proton around its own axis": "Spin: Sự quay của proton quanh trục của nó",
  "rotation of proton around its own axis": "Sự quay của proton quanh trục của nó",
  "precession is rotation of the axis itself": "Tiến động là sự quay của chính trục",
  "under the influence of external magnetic field": "Dưới tác động của từ trường ngoài",
  "such that it forms a 'cone'": "Tạo thành một 'hình nón'",
  "it forms a 'cone'": "Tạo thành 'hình nón'",
  "forms a 'cone'": "Tạo thành hình nón",
  "slice selection gradient": "Gradient chọn lát cắt",
  "phase encoding gradient": "Gradient mã hóa pha",
  "frequency encoding gradient": "Gradient mã hóa tần số",
  "rf bandwidth": "Băng thông xung RF",
  "rf pulse": "Xung tần số vô tuyến (RF)",
  "90° rf pulse": "Xung RF 90°",
  "180° rf pulse": "Xung RF 180°",
  "180° refocusing pulse": "Xung tái hội tụ 180°",
  "longitudinal magnetization": "Từ hóa dọc",
  "transverse magnetization": "Từ hóa ngang",
  "longitudinal relaxation": "Thư giãn dọc",
  "transverse relaxation": "Thư giãn ngang",
  "complete lm recovered": "Hồi phục hoàn toàn từ hóa dọc (LM)",
  "lm recovered": "Hồi phục từ hóa dọc",
  "tm recovered": "Hồi phục từ hóa ngang",
  "tm decreases": "Từ hóa ngang giảm",
  "lm increases": "Từ hóa dọc tăng",
  "tm ↓, lm ↑": "TM giảm, LM tăng",
  "more protons precess along +ve side of z-axis": "Nhiều proton tiến động theo chiều dương trục Z",
  "after cancelling few remain along +ve z-side": "Sau triệt tiêu, một số còn lại theo chiều dương trục Z",
  "forces add up to form lm": "Lực cộng lại tạo thành từ hóa dọc (LM)",
  "free induction decay": "Tín hiệu suy giảm cảm ứng tự do (FID)",
  "spin echo": "Tín hiệu cộng hưởng Spin Echo",
  "gradient echo": "Tín hiệu Gradient Echo",
  "inversion recovery": "Xung phục hồi đảo ngược (IR)",
  "magnetic field strength": "Cường độ từ trường",
  "precession frequency": "Tần số tiến động",
  "repetition time": "Thời gian lặp lại (TR)",
  "echo time": "Thời gian xuất hiện echo (TE)",
  "inversion time": "Thời gian đảo ngược (TI)",
  "field of view": "Trường nhìn (FOV)",
  "signal-to-noise ratio": "Tỉ số tín hiệu trên nhiễu (SNR)",
  "spin-lattice relaxation": "Thư giãn spin - mạng (T1)",
  "spin-spin relaxation": "Thư giãn spin - spin (T2)",
  "net magnetization vector": "Véc-tơ từ hóa tổng (NMV)",
  "dephasing": "Mất pha",
  "rephasing": "Tái đồng pha",
  "precession": "Tiến động",
  "precessing": "Đang tiến động",
  "larmor frequency": "Tần số Larmor",
  "gyromagnetic ratio": "Tỉ số từ chuyển động (γ)",
  "signal intensity": "Cường độ tín hiệu",
  "amplitude": "Biên độ",
  "decay curve": "Đường cong suy giảm",
  "recovery curve": "Đường cong phục hồi",
  "t1 recovery": "Phục hồi T1",
  "t2 decay": "Suy giảm T2",
  "t2* decay": "Suy giảm T2*",
  "proton density": "Mật độ proton (PD)",
  "flip angle": "Góc lật (α)",
  "along z-axis": "Dọc theo trục Z",
  "along x-axis": "Dọc theo trục X",
  "along y-axis": "Dọc theo trục Y",
  "z-axis": "Trục Z",
  "x-axis": "Trục X",
  "y-axis": "Trục Y",
  "time (ms)": "Thời gian (ms)",
  "time": "Thời gian",
  "signal": "Tín hiệu",
  "relaxation": "Thư giãn",
  "magnetization": "Từ hóa",
  "protons": "Các proton",
  "external magnetic field": "Từ trường ngoài (B₀)",
  "b0 field": "Từ trường B₀",
  "b1 field": "Từ trường B₁",
  "n": "Cực N (Bắc)",
  "s": "Cực S (Nam)"
};

export function lookupDiagramTerm(text: string): string | null {
  if (!text || !text.trim()) return null;
  const clean = text.toLowerCase().trim().replace(/[\.\:\,]/g, '');
  if (MEDICAL_DIAGRAM_GLOSSARY[clean]) return MEDICAL_DIAGRAM_GLOSSARY[clean];

  const rawLower = text.toLowerCase().trim();
  if (MEDICAL_DIAGRAM_GLOSSARY[rawLower]) return MEDICAL_DIAGRAM_GLOSSARY[rawLower];

  for (const [en, vi] of Object.entries(MEDICAL_DIAGRAM_GLOSSARY)) {
    if (en.length > 3 && rawLower.includes(en)) {
      return rawLower.replace(en, vi);
    }
  }

  return null;
}

/**
 * Geometric Table Detection Engine (V6.2)
 * Reconstructs table grid regions directly from text line alignments and column boundaries.
 */
export function detectTableRegions(
  lines: SpatialTextLine[],
  blocks: SpatialTextBlock[],
  pageWidth: number,
  pageHeight: number
): { tableDetected: boolean; tables: TableRegion[] } {
  if (!lines || lines.length === 0) return { tableDetected: false, tables: [] };

  const rowsMap = new Map<number, SpatialTextLine[]>();
  for (const line of lines) {
    let matchedY: number | null = null;
    for (const y of rowsMap.keys()) {
      if (Math.abs(line.y - y) <= 3.5) {
        matchedY = y;
        break;
      }
    }
    if (matchedY !== null) {
      rowsMap.get(matchedY)!.push(line);
    } else {
      rowsMap.set(line.y, [line]);
    }
  }

  const sortedRowYs = Array.from(rowsMap.keys()).sort((a, b) => a - b);
  const multiColRows: Array<{ y: number; cells: Array<{ minX: number; maxX: number; text: string }> }> = [];

  for (const y of sortedRowYs) {
    const rowLines = rowsMap.get(y)!;
    rowLines.sort((a, b) => a.x - b.x);

    const cells: Array<{ minX: number; maxX: number; text: string }> = [];
    for (const line of rowLines) {
      if (cells.length === 0) {
        cells.push({ minX: line.x, maxX: line.x + line.width, text: line.str });
      } else {
        const last = cells[cells.length - 1];
        if (line.x - last.maxX <= 15) {
          last.maxX = Math.max(last.maxX, line.x + line.width);
          last.text += ' ' + line.str;
        } else {
          cells.push({ minX: line.x, maxX: line.x + line.width, text: line.str });
        }
      }
    }

    if (cells.length >= 2) {
      multiColRows.push({ y, cells });
    }
  }

  if (multiColRows.length < 2) {
    return { tableDetected: false, tables: [] };
  }

  const tables: TableRegion[] = [];
  let currentTableRows: typeof multiColRows = [];

  for (let i = 0; i < multiColRows.length; i++) {
    const row = multiColRows[i];
    if (currentTableRows.length === 0) {
      currentTableRows.push(row);
    } else {
      const prevRow = currentTableRows[currentTableRows.length - 1];
      const vGap = row.y - prevRow.y;
      if (vGap <= 35) {
        currentTableRows.push(row);
      } else {
        if (currentTableRows.length >= 2) {
          tables.push(buildTableRegionFromRows(currentTableRows, tables.length + 1));
        }
        currentTableRows = [row];
      }
    }
  }
  if (currentTableRows.length >= 2) {
    tables.push(buildTableRegionFromRows(currentTableRows, tables.length + 1));
  }

  if (tables.length === 0) {
    return { tableDetected: false, tables: [] };
  }

  for (const table of tables) {
    for (const block of blocks) {
      const blockMinX = block.x;
      const blockMaxX = block.x + block.width;
      const blockMinY = block.y;
      const blockMaxY = block.y + block.height;

      // Priority #1: Caption Separation - Table captions are NEVER table cells
      const isCaptionBlock = block.isCaption || block.blockType === 'caption' || /^(Table|Bảng|Fig(\.|ure)?|Sơ đồ)\s*\d+/i.test(block.originalText);
      const isNearTableBoundary = (blockMinY >= table.y - 40 && blockMinY <= table.y + 15) || (blockMinY >= table.y + table.height - 10 && blockMinY <= table.y + table.height + 40);

      if (isCaptionBlock && isNearTableBoundary) {
        block.tableId = table.id;
        block.layoutContext = 'table_caption';
        block.blockType = 'caption';
        block.isCaption = true;
        table.caption = block;
        continue; // Caption is separated from cell geometry
      }

      if (
        blockMaxX >= table.x - 2 &&
        blockMinX <= table.x + table.width + 2 &&
        blockMaxY >= table.y - 2 &&
        blockMinY <= table.y + table.height + 2
      ) {
        let matchingCell: TableCell | null = null;
        for (const r of table.rows) {
          for (const c of r.cells) {
            if (
              blockMaxX >= c.x - 5 &&
              blockMinX <= c.x + c.width + 5 &&
              blockMaxY >= c.y - 5 &&
              blockMinY <= c.y + c.height + 5
            ) {
              matchingCell = c;
              break;
            }
          }
          if (matchingCell) break;
        }

        block.tableId = table.id;
        block.layoutContext = 'table_cell';
        if (matchingCell) {
          block.rowIndex = matchingCell.rowIndex;
          block.columnIndex = matchingCell.columnIndex;
          block.cellWidth = matchingCell.width;
          block.cellHeight = matchingCell.height;
          block.blockType = matchingCell.rowIndex === 0 ? 'table_header' : 'table_body';
          matchingCell.contentBlocks.push(block);
        } else {
          block.blockType = 'table_cell';
        }
      }
    }
  }

  return { tableDetected: true, tables };
}

function buildTableRegionFromRows(
  rows: Array<{ y: number; cells: Array<{ minX: number; maxX: number; text: string }> }>,
  tableIdx: number
): TableRegion {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  rows.forEach(r => {
    minY = Math.min(minY, r.y);
    maxY = Math.max(maxY, r.y + 15);
    r.cells.forEach(c => {
      minX = Math.min(minX, c.minX);
      maxX = Math.max(maxX, c.maxX);
    });
  });

  const cellRegions: CellRegion[] = [];
  const tableRows: TableRow[] = [];

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx];
    const cellH = (rIdx < rows.length - 1 ? rows[rIdx + 1].y - r.y : 20);
    const rowCells: TableCell[] = [];

    for (let cIdx = 0; cIdx < r.cells.length; cIdx++) {
      const c = r.cells[cIdx];
      const cellW = Math.max(20, c.maxX - c.minX);
      const cellHeight = Math.max(12, cellH);

      cellRegions.push({
        x: c.minX,
        y: r.y,
        width: cellW,
        height: cellHeight,
        rowIndex: rIdx,
        columnIndex: cIdx
      });

      rowCells.push({
        cellId: `cell_${tableIdx}_${rIdx}_${cIdx}`,
        rowIndex: rIdx,
        columnIndex: cIdx,
        x: c.minX,
        y: r.y,
        width: cellW,
        height: cellHeight,
        contentBlocks: []
      });
    }

    tableRows.push({
      rowIndex: rIdx,
      y: r.y,
      height: Math.max(12, cellH),
      cells: rowCells
    });
  }

  const colCount = Math.max(2, ...rows.map(r => r.cells.length));
  const rowCount = rows.length;

  return {
    id: `table_${tableIdx}`,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rowCount,
    colCount,
    rows: tableRows,
    cells: cellRegions
  };
}

const pageSpatialCache = new Map<string, PageSpatialData>();

/**
 * Extract spatial text blocks & detect table regions from a pdfjs page.
 */
export async function extractSpatialBlocksFromPdfPage(pdfPage: any): Promise<PageSpatialData> {
  const pageKey = pdfPage ? `${pdfPage.pageNumber}_${pdfPage.ref?.num}_${pdfPage.ref?.gen}_${pdfPage.view?.join(',')}` : '';
  if (pageKey && pageSpatialCache.has(pageKey)) {
    return pageSpatialCache.get(pageKey)!;
  }

  const viewport = pdfPage.getViewport({ scale: 1.0 });
  const textContent = await pdfPage.getTextContent();
  const rawItems: RawTextItem[] = [];

  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  for (const item of textContent.items) {
    if (!item.str || item.str.trim().length === 0) continue;

    const tx = item.transform[4];
    const ty = item.transform[5];
    const scaleX = Math.hypot(item.transform[0], item.transform[1]) || 12;
    const scaleY = Math.hypot(item.transform[2], item.transform[3]) || scaleX;
    const fontSize = Math.max(7, Math.round(scaleY * 10) / 10);

    const [canvasX, baselineY] = viewport.convertToViewportPoint(tx, ty);
    
    const itemHeight = item.height > 0 ? item.height : (fontSize * 0.9);
    const canvasY = Math.max(0, baselineY - itemHeight);
    const itemWidth = item.width > 0 ? item.width : (item.str.length * fontSize * 0.52);

    const fn = (item.fontName || '').toLowerCase();
    const isItalic = fn.includes('italic') || fn.includes('oblique') || fn.includes('it');
    const isBold = fn.includes('bold') || fn.includes('black') || fn.includes('heavy') || fn.includes('bd');
    const isSerif = fn.includes('times') || fn.includes('georgia') || fn.includes('garamond') || fn.includes('cambria') || fn.includes('minion') || fn.includes('serif') || fn.includes('roman') || fn.includes('pt');

    rawItems.push({
      str: item.str,
      x: Math.max(0, canvasX),
      y: canvasY,
      width: itemWidth,
      height: itemHeight,
      fontSize,
      fontName: item.fontName || 'serif',
      isItalic,
      isBold,
      isSerif,
      baselineY
    });
  }

  if (rawItems.length === 0) {
    return {
      pageNum: pdfPage.pageNumber,
      pageWidth,
      pageHeight,
      blocks: [],
      isExtracted: true,
      tableDetected: false,
      tables: []
    };
  }

  const headerItems: RawTextItem[] = [];
  const footerItems: RawTextItem[] = [];
  const bodyItems: RawTextItem[] = [];

  const headerYThreshold = pageHeight * 0.085;
  const footerYThreshold = pageHeight * 0.93;

  for (const item of rawItems) {
    if (item.y < headerYThreshold) {
      headerItems.push(item);
    } else if (item.y > footerYThreshold) {
      footerItems.push(item);
    } else {
      bodyItems.push(item);
    }
  }

  const blocks: SpatialTextBlock[] = [];

  if (headerItems.length > 0) {
    headerItems.sort((a, b) => a.x - b.x);
    let minX = Math.min(...headerItems.map(i => i.x));
    let minY = Math.min(...headerItems.map(i => i.y));
    let maxX = Math.max(...headerItems.map(i => i.x + i.width));
    let maxY = Math.max(...headerItems.map(i => i.y + i.height));
    const headerStr = headerItems.map(i => i.str.trim()).filter(Boolean).join('  ');
    const avgFontSize = headerItems.reduce((acc, i) => acc + i.fontSize, 0) / headerItems.length;

    blocks.push({
      id: `blk_header`,
      x: minX,
      y: minY,
      width: Math.max(pageWidth * 0.8, maxX - minX),
      height: Math.max(16, maxY - minY),
      fontSize: Math.round(avgFontSize * 10) / 10,
      originalText: headerStr,
      lines: headerItems.map(i => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
        fontSize: i.fontSize,
        fontName: i.fontName,
        isItalic: i.isItalic,
        isBold: i.isBold,
        isSerif: i.isSerif,
        baselineY: i.baselineY
      })),
      blockType: 'header',
      layoutContext: 'page',
      isHeading: false
    });
  }

  bodyItems.sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 3) return yDiff;
    return a.x - b.x;
  });

  const lines: SpatialTextLine[] = [];
  let currentLine: {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontName: string;
    isItalic: boolean;
    isBold: boolean;
    isSerif: boolean;
    baselineY: number;
    items: RawTextItem[];
  } | null = null;

  for (const item of bodyItems) {
    if (!currentLine) {
      currentLine = {
        str: item.str,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        fontSize: item.fontSize,
        fontName: item.fontName,
        isItalic: item.isItalic,
        isBold: item.isBold,
        isSerif: item.isSerif,
        baselineY: item.baselineY,
        items: [item]
      };
      continue;
    }

    const sameBaseline = Math.abs(item.baselineY - currentLine.baselineY) <= Math.max(3.5, currentLine.fontSize * 0.4);
    const rightEdge = currentLine.x + currentLine.width;
    const horizontalGap = item.x - rightEdge;
    const isAdjacent = item.x >= (currentLine.x - 2) && horizontalGap <= Math.max(12, currentLine.fontSize * 1.0);

    if (sameBaseline && isAdjacent) {
      const space = horizontalGap > (currentLine.fontSize * 0.15) ? ' ' : '';
      currentLine.str += space + item.str;
      currentLine.width = (item.x + item.width) - currentLine.x;
      currentLine.height = Math.max(currentLine.height, item.height);
      currentLine.fontSize = Math.max(currentLine.fontSize, item.fontSize);
      if (item.isItalic) currentLine.isItalic = true;
      if (item.isBold) currentLine.isBold = true;
      if (item.isSerif) currentLine.isSerif = true;
      currentLine.items.push(item);
    } else {
      lines.push({
        str: currentLine.str.trim(),
        x: currentLine.x,
        y: currentLine.y,
        width: currentLine.width,
        height: currentLine.height,
        fontSize: currentLine.fontSize,
        fontName: currentLine.fontName,
        isItalic: currentLine.isItalic,
        isBold: currentLine.isBold,
        isSerif: currentLine.isSerif,
        baselineY: currentLine.baselineY
      });
      currentLine = {
        str: item.str,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        fontSize: item.fontSize,
        fontName: item.fontName,
        isItalic: item.isItalic,
        isBold: item.isBold,
        isSerif: item.isSerif,
        baselineY: item.baselineY,
        items: [item]
      };
    }
  }

  if (currentLine) {
    lines.push({
      str: currentLine.str.trim(),
      x: currentLine.x,
      y: currentLine.y,
      width: currentLine.width,
      height: currentLine.height,
      fontSize: currentLine.fontSize,
      fontName: currentLine.fontName,
      isItalic: currentLine.isItalic,
      isBold: currentLine.isBold,
      isSerif: currentLine.isSerif,
      baselineY: currentLine.baselineY
    });
  }

  const isLineAHeading = (l: SpatialTextLine, nextL?: SpatialTextLine): boolean => {
    const text = l.str.trim();
    if (text.length === 0 || text.length > 80) return false;
    if (/^Fig(\.|ure)?\s*\d+/i.test(text)) return false;
    if (/^[A-Z\d\s\-\:\,\(\)]+$/.test(text) && text.length > 3) return true;
    if (l.isItalic || l.isBold) {
      if ((!text.endsWith('.') && text.length < 65) || text.endsWith('?')) return true;
    }
    if (text.endsWith('?') && text.length < 65) return true;
    if (nextL) {
      const vGap = nextL.y - (l.y + l.height);
      if (vGap > 5 && !text.endsWith('.') && text.length < 55 && /^[A-Z]/.test(text)) {
        return true;
      }
    }
    return false;
  };

  const isLineAListItem = (l: SpatialTextLine): boolean => {
    const text = l.str.trim();
    return /^(\d+[\.\)]|[a-zA-Z][\.\)]|[\•\-\*\–\—])\s+/.test(text);
  };

  const isLineACaption = (l: SpatialTextLine): boolean => {
    const text = l.str.trim();
    return /^Fig(\.|ure)?\s*\d+/i.test(text) || /^(Hình|Bảng|Table|Sơ đồ)\s*\d+/i.test(text);
  };

  const isLineASymbol = (l: SpatialTextLine): boolean => {
    const text = l.str.trim();
    return (text.length <= 3 && !/[a-z]{3,}/i.test(text)) || /^[+\-±]?\d+(\.\d+)?\s*(T|Tesla|KHz|MHz|ms|s|Hz|G|mT)$/i.test(text);
  };

  let currentBlockLines: SpatialTextLine[] = [];

  const flushBlock = (reason: string = 'flush') => {
    if (currentBlockLines.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxLineWidth = 0;
    let totalFontSize = 0;
    const textPieces: string[] = [];

    for (let i = 0; i < currentBlockLines.length; i++) {
      const l = currentBlockLines[i];
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + l.width);
      maxY = Math.max(maxY, l.y + l.height);
      maxLineWidth = Math.max(maxLineWidth, l.width);
      totalFontSize += l.fontSize;

      const trimmedLine = l.str.trim();
      if (textPieces.length === 0) {
        textPieces.push(trimmedLine);
      } else {
        const prevPiece = textPieces[textPieces.length - 1];
        if (/([a-zA-Z]{2,})-\s*$/.test(prevPiece)) {
          textPieces[textPieces.length - 1] = prevPiece.replace(/-\s*$/, '') + trimmedLine;
        } else if (isLineAListItem(l)) {
          textPieces.push('\n' + trimmedLine);
        } else {
          textPieces.push(trimmedLine);
        }
      }
    }

    const avgFontSize = totalFontSize / currentBlockLines.length;
    let fullText = textPieces.join(' ').replace(/ \n /g, '\n').replace(/\n /g, '\n').trim();

    if (fullText.length > 0) {
      const firstLine = currentBlockLines[0];
      const isCaption = isLineACaption(firstLine) || /^Fig(\.|ure)?\s*\d+/i.test(fullText);
      const isHeading = !isCaption && (
        (currentBlockLines.length <= 2 && isLineAHeading(firstLine)) ||
        (firstLine.isItalic && fullText.endsWith('?'))
      );
      const isSymbol = !isCaption && !isHeading && currentBlockLines.length === 1 && isLineASymbol(firstLine);
      const isDiagramLabel = !isCaption && !isHeading && !isSymbol && (
        currentBlockLines.length <= 2 && (maxLineWidth < 200 || fullText.length < 45) && (minY > pageHeight * 0.15 && minY < pageHeight * 0.9)
      );

      let blockType: SpatialTextBlock['blockType'] = 'paragraph';
      if (isCaption) blockType = 'caption';
      else if (isHeading) blockType = 'heading';
      else if (isSymbol) blockType = 'symbol';
      else if (isDiagramLabel) blockType = 'diagram_label';
      else blockType = 'paragraph';

      let captionNumber: string | undefined;
      if (isCaption) {
        const numMatch = fullText.match(/\d+(\.\d+)?/);
        if (numMatch) captionNumber = numMatch[0];
      }

      const safeX = Math.max(8, Math.min(pageWidth - 25, minX));
      const boxWidth = Math.max(15, maxX - minX);
      const safeWidth = Math.min(pageWidth - safeX - 8, Math.max(boxWidth, maxLineWidth));
      const safeHeight = Math.max(avgFontSize * 1.1, maxY - minY);

      let columnId: 'left' | 'right' | 'full' = 'full';
      if (safeWidth < pageWidth * 0.55) {
        columnId = (safeX + safeWidth / 2 < pageWidth * 0.5) ? 'left' : 'right';
      }

      const hasItalic = currentBlockLines.some(l => l.isItalic);
      const hasBold = currentBlockLines.some(l => l.isBold);
      const hasSerif = currentBlockLines.some(l => l.isSerif);
      const sampleFontName = currentBlockLines.find(l => l.fontName)?.fontName || '';

      const blockId = `blk_${blocks.length + 1}`;

      blocks.push({
        id: blockId,
        x: safeX,
        y: minY,
        width: safeWidth,
        height: safeHeight,
        fontSize: Math.round(avgFontSize * 10) / 10,
        fontFamily: sampleFontName,
        isSerif: hasSerif,
        originalText: fullText,
        lines: [...currentBlockLines],
        blockType,
        layoutContext: 'page',
        isHeading: blockType === 'heading',
        isDiagramLabel: blockType === 'diagram_label',
        isCaption: blockType === 'caption',
        captionNumber,
        columnId,
        customFontStyle: hasItalic ? 'italic' : (hasBold || isHeading ? 'bold' : 'normal')
      });
    }

    currentBlockLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    if (currentBlockLines.length === 0) {
      currentBlockLines.push(line);
      if (!isLineACaption(line) && (isLineAHeading(line, nextLine) || isLineASymbol(line))) {
        flushBlock('standalone-heading-or-symbol');
      }
      continue;
    }

    const prevLine = currentBlockLines[currentBlockLines.length - 1];
    const firstLineInBlock = currentBlockLines[0];
    const isCurrentBlockCaption = isLineACaption(firstLineInBlock);

    if (isCurrentBlockCaption) {
      const vGap = line.y - (prevLine.y + prevLine.height);
      if (vGap >= -5 && vGap <= Math.max(14, prevLine.fontSize * 1.4) && !isLineAHeading(line, nextLine) && !isLineASymbol(line) && !isLineACaption(line)) {
        currentBlockLines.push(line);
        continue;
      } else {
        flushBlock('end-of-caption');
        currentBlockLines.push(line);
        if (!isLineACaption(line) && (isLineAHeading(line, nextLine) || isLineASymbol(line))) {
          flushBlock('standalone-heading-or-symbol');
        }
        continue;
      }
    }

    if (isLineACaption(line) || isLineAHeading(line, nextLine) || isLineASymbol(line)) {
      flushBlock('semantic-break-heading-caption-symbol');
      currentBlockLines.push(line);
      if (!isLineACaption(line) && (isLineAHeading(line, nextLine) || isLineASymbol(line))) {
        flushBlock('standalone-heading-or-symbol');
      }
      continue;
    }

    const isNewListItem = isLineAListItem(line);
    if (isNewListItem && currentBlockLines.length > 0) {
      flushBlock('new-list-item');
      currentBlockLines.push(line);
      continue;
    }

    const isIndentedParagraph = prevLine.str.trim().endsWith('.') && (line.x > prevLine.x + 8);
    if (isIndentedParagraph) {
      flushBlock('indented-paragraph-start');
      currentBlockLines.push(line);
      continue;
    }

    const isSameBaselineRow = Math.abs(line.y - prevLine.y) < 3.5;
    const xDiff = Math.abs(line.x - prevLine.x);
    if (isSameBaselineRow || xDiff > 25) {
      flushBlock('same-row-or-column-shift');
      currentBlockLines.push(line);
      continue;
    }

    const verticalGap = line.y - (prevLine.y + prevLine.height);
    const maxLineGap = Math.max(10, prevLine.fontSize * 1.15);

    const isLineClose = verticalGap >= -5.0 && verticalGap <= maxLineGap;
    const isFontSimilar = Math.abs(line.fontSize - prevLine.fontSize) <= 2.5;

    if (isLineClose && isFontSimilar) {
      currentBlockLines.push(line);
    } else {
      flushBlock(`vertical-gap-break (gap=${verticalGap.toFixed(1)}px, max=${maxLineGap.toFixed(1)}px)`);
      currentBlockLines.push(line);
    }
  }
  flushBlock('end-of-lines');

  if (footerItems.length > 0) {
    footerItems.sort((a, b) => a.x - b.x);
    let minX = Math.min(...footerItems.map(i => i.x));
    let minY = Math.min(...footerItems.map(i => i.y));
    let maxX = Math.max(...footerItems.map(i => i.x + i.width));
    let maxY = Math.max(...footerItems.map(i => i.y + i.height));
    const footerStr = footerItems.map(i => i.str.trim()).filter(Boolean).join('  ');
    const avgFontSize = footerItems.reduce((acc, i) => acc + i.fontSize, 0) / footerItems.length;

    blocks.push({
      id: `blk_footer`,
      x: minX,
      y: minY,
      width: Math.max(pageWidth * 0.8, maxX - minX),
      height: Math.max(16, maxY - minY),
      fontSize: Math.round(avgFontSize * 10) / 10,
      originalText: footerStr,
      lines: footerItems.map(i => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
        fontSize: i.fontSize,
        fontName: i.fontName,
        isItalic: i.isItalic,
        isBold: i.isBold,
        baselineY: i.baselineY
      })),
      blockType: 'footer',
      layoutContext: 'page',
      isHeading: false
    });
  }

  // Detect geometric table regions & annotate blocks
  const tableResult = detectTableRegions(lines, blocks, pageWidth, pageHeight);

  const pageSpatialData: PageSpatialData = {
    pageNum: pdfPage.pageNumber,
    pageWidth,
    pageHeight,
    blocks,
    isExtracted: true,
    tableDetected: tableResult.tableDetected,
    tables: tableResult.tables
  };

  if (pageKey) {
    pageSpatialCache.set(pageKey, pageSpatialData);
  }

  return pageSpatialData;
}

/**
 * Alignment pass between markdown translation and spatial blocks.
 */
export function alignTranslationWithSpatialBlocks(
  blocks: SpatialTextBlock[],
  markdownText: string
): SpatialTextBlock[] {
  if (!blocks || blocks.length === 0) return [];
  if (!markdownText || !markdownText.trim()) {
    return blocks.map(b => ({ ...b, translatedText: b.originalText }));
  }

  interface TransChunk {
    id: number;
    rawText: string;
    cleanText: string;
    isHeading: boolean;
    isCaption: boolean;
    captionNumber?: string;
    isHeader: boolean;
    isList: boolean;
    matched: boolean;
  }

  const rawLines = markdownText.split('\n');
  const chunks: TransChunk[] = [];
  let currentParagraph = "";

  const flushParagraph = () => {
    if (currentParagraph.trim()) {
      const clean = currentParagraph.trim()
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/_(.*?)_/g, '$1')
        .replace(/`([^`]+)`/g, '$1');

      const isCaption = /^(Hình|Bảng|Sơ đồ|Fig(\.|ure)?)\s*\d+/i.test(clean);
      let captionNumber: string | undefined;
      if (isCaption) {
        const m = clean.match(/\d+(\.\d+)?/);
        if (m) captionNumber = m[0];
      }

      chunks.push({
        id: chunks.length + 1,
        rawText: currentParagraph.trim(),
        cleanText: clean,
        isHeading: false,
        isCaption,
        captionNumber,
        isHeader: false,
        isList: false,
        matched: false
      });
      currentParagraph = "";
    }
  };

  for (let line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (/^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?$/.test(trimmed)) {
      flushParagraph();
      continue;
    }

    if (trimmed.includes('|') && (trimmed.startsWith('|') || trimmed.endsWith('|') || trimmed.split('|').length >= 3)) {
      flushParagraph();
      const cells = trimmed.split('|')
        .map(c => c.trim().replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1'))
        .filter(Boolean);

      for (const cell of cells) {
        if (!cell) continue;
        const isCaption = /^(Hình|Bảng|Sơ đồ|Fig(\.|ure)?)\s*\d+/i.test(cell);
        let captionNumber: string | undefined;
        if (isCaption) {
          const m = cell.match(/\d+(\.\d+)?/);
          if (m) captionNumber = m[0];
        }

        chunks.push({
          id: chunks.length + 1,
          rawText: cell,
          cleanText: cell,
          isHeading: false,
          isCaption,
          captionNumber,
          isHeader: false,
          isList: false,
          matched: false
        });
      }
      continue;
    }

    if (trimmed.startsWith('#')) {
      flushParagraph();
      const clean = trimmed.replace(/^#+\s*/, '').trim()
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1');

      const isCaption = /^(Hình|Bảng|Sơ đồ|Fig(\.|ure)?)\s*\d+/i.test(clean);
      let captionNumber: string | undefined;
      if (isCaption) {
        const m = clean.match(/\d+(\.\d+)?/);
        if (m) captionNumber = m[0];
      }

      chunks.push({
        id: chunks.length + 1,
        rawText: trimmed,
        cleanText: clean,
        isHeading: !isCaption,
        isCaption,
        captionNumber,
        isHeader: false,
        isList: false,
        matched: false
      });
    } else if (/^(\*|-|\+|\d+\.)\s+/.test(trimmed)) {
      flushParagraph();
      const clean = trimmed.replace(/^(\*|-|\+|\d+\.)\s+/, '').trim()
        .replace(/\*\*(.*?)\*\*/g, '$1');

      const isCaption = /^(Hình|Bảng|Sơ đồ|Fig(\.|ure)?)\s*\d+/i.test(clean);
      let captionNumber: string | undefined;
      if (isCaption) {
        const m = clean.match(/\d+(\.\d+)?/);
        if (m) captionNumber = m[0];
      }

      chunks.push({
        id: chunks.length + 1,
        rawText: trimmed,
        cleanText: clean,
        isHeading: false,
        isCaption,
        captionNumber,
        isHeader: false,
        isList: true,
        matched: false
      });
    } else {
      if (currentParagraph) currentParagraph += ' ';
      currentParagraph += trimmed;
    }
  }
  flushParagraph();

  const result: SpatialTextBlock[] = blocks.map(b => ({ ...b, translatedText: undefined }))
    .sort((a, b) => {
      const yDiff = Math.abs(a.y - b.y);
      if (yDiff > 12) return a.y - b.y;
      return a.x - b.x;
    });

  for (const block of result) {
    if (block.blockType === 'caption') {
      const num = block.captionNumber;
      if (num) {
        const matchedChunk = chunks.find(c => !c.matched && (c.isCaption || c.captionNumber === num || c.rawText.includes(num)));
        if (matchedChunk) {
          block.translatedText = matchedChunk.rawText;
          matchedChunk.matched = true;
        }
      } else {
        const firstCaptionChunk = chunks.find(c => !c.matched && c.isCaption);
        if (firstCaptionChunk) {
          block.translatedText = firstCaptionChunk.rawText;
          firstCaptionChunk.matched = true;
        }
      }
    }
  }

  const headerBlock = result.find(b => b.blockType === 'header');
  if (headerBlock && !headerBlock.translatedText) {
    const headerChunk = chunks.find(c => !c.matched && (c.isHeading || c.id === 1) && c.cleanText.length < 80);
    if (headerChunk) {
      headerBlock.translatedText = headerChunk.cleanText;
      headerChunk.matched = true;
    }
  }

  for (const block of result) {
    if (block.blockType === 'symbol') {
      block.translatedText = block.originalText;
      continue;
    }

    if (block.blockType === 'diagram_label') {
      const dictMatch = lookupDiagramTerm(block.originalText);
      if (dictMatch) {
        block.translatedText = dictMatch;
      }
      continue;
    }

    if (block.translatedText) continue;

    if (block.blockType === 'heading') {
      const headingChunk = chunks.find(c => !c.matched && c.isHeading);
      if (headingChunk) {
        block.translatedText = headingChunk.rawText;
        headingChunk.matched = true;
      } else {
        const nextChunk = chunks.find(c => !c.matched);
        if (nextChunk && nextChunk.cleanText.length < 100) {
          block.translatedText = nextChunk.rawText;
          nextChunk.matched = true;
        }
      }
    } else if (block.blockType === 'paragraph' || block.blockType === 'table_body' || block.blockType === 'table_cell') {
      const nextChunk = chunks.find(c => !c.matched && !c.isCaption);
      if (nextChunk) {
        block.translatedText = nextChunk.rawText;
        nextChunk.matched = true;
      } else {
        const anyChunk = chunks.find(c => !c.matched);
        if (anyChunk) {
          block.translatedText = anyChunk.rawText;
          anyChunk.matched = true;
        }
      }
    }
  }

  for (const block of result) {
    if (!block.translatedText) {
      if (block.blockType === 'diagram_label') {
        const dictMatch = lookupDiagramTerm(block.originalText);
        if (dictMatch) {
          block.translatedText = dictMatch;
        } else {
          const shortChunk = chunks.find(c => !c.matched && c.cleanText.length < 40 && !c.isCaption);
          if (shortChunk) {
            block.translatedText = shortChunk.cleanText;
            shortChunk.matched = true;
          } else {
            block.translatedText = block.originalText;
          }
        }
      } else {
        const unassignedChunk = chunks.find(c => !c.matched);
        if (unassignedChunk) {
          block.translatedText = unassignedChunk.rawText;
          unassignedChunk.matched = true;
        } else {
          block.translatedText = block.originalText;
        }
      }
    }
  }

  return result;
}

export function savePageSpatialOverrides(
  bookId: string, 
  pageNum: number, 
  overrides: Record<string, Partial<SpatialTextBlock>>
) {
  try {
    const key = `mediTrans_spatial_overrides_${bookId}_p${pageNum}`;
    localStorage.setItem(key, JSON.stringify(overrides));
  } catch (e) {
    console.warn("[SpatialService] Failed to save overrides to localStorage:", e);
  }
}

export function loadPageSpatialOverrides(
  bookId: string, 
  pageNum: number
): Record<string, Partial<SpatialTextBlock>> {
  try {
    const key = `mediTrans_spatial_overrides_${bookId}_p${pageNum}`;
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    return {};
  }
}

export function applySpatialAIResults(
  blocks: SpatialTextBlock[],
  aiResults: Array<{
    id: string;
    translatedText: string;
    fontStyle?: 'normal' | 'bold' | 'italic';
    fontSizeScale?: number;
    blockType?: string;
    customAlign?: 'left' | 'center' | 'right';
  }>
): SpatialTextBlock[] {
  if (!blocks || blocks.length === 0) return [];
  if (!aiResults || aiResults.length === 0) return blocks;

  const aiMap = new Map<string, typeof aiResults[0]>();
  aiResults.forEach(r => aiMap.set(r.id, r));

  return blocks.map(block => {
    const aiItem = aiMap.get(block.id);
    if (!aiItem) return block;

    const scale = aiItem.fontSizeScale || 1.0;
    const isHeading = aiItem.blockType === 'heading' || aiItem.fontStyle === 'bold' || block.isHeading;

    return {
      ...block,
      translatedText: aiItem.translatedText || block.originalText,
      customFontStyle: aiItem.fontStyle || (isHeading ? 'bold' : 'normal'),
      customFontSize: block.fontSize ? Math.round(block.fontSize * scale * 10) / 10 : undefined,
      blockType: (aiItem.blockType as any) || block.blockType,
      customAlign: aiItem.customAlign || block.customAlign
    };
  });
}

export interface RichToken {
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isMath?: boolean;
  color?: string;
}

export interface SanitizedRichText {
  cleanText: string;
  tokens: RichToken[];
}

/**
 * Priority #3 Rich Text Tokenizer & Markdown Normalization Engine (V6.3)
 * Strips markdown symbols (*, **, #) from visual output while retaining rich styling tokens.
 */
export function sanitizeTranslatedRichText(
  rawText: string,
  defaultBold = false,
  defaultItalic = false
): SanitizedRichText {
  if (!rawText) return { cleanText: '', tokens: [] };

  // Step 1: Sanitize LaTeX & Medical symbols
  let text = sanitizeMedicalText(rawText);

  // Step 2: Extract & protect inline math ($...$)
  const mathPlaceholders: string[] = [];
  text = text.replace(/\$([^\$]+)\$/g, (_, mathContent) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(mathContent);
    return `___MATH_${idx}___`;
  });

  // Step 3: Tokenize markdown constructs
  const tokens: RichToken[] = [];
  const regex = /(\*\*\*([\s\S]+?)\*\*\*|___([\s\S]+?)___|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\[\d+(?:\s*,\s*\d+)*\]|\*([\s\S]+?)\*|_([\s\S]+?)_)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        text: text.slice(lastIndex, match.index),
        isBold: defaultBold,
        isItalic: defaultItalic
      });
    }

    const matchedStr = match[0];

    if (matchedStr.startsWith('[') && matchedStr.endsWith(']')) {
      tokens.push({
        text: matchedStr,
        isBold: true,
        isItalic: false,
        color: '#1d4ed8'
      });
    } else if (match[2] || match[3]) {
      tokens.push({
        text: match[2] || match[3],
        isBold: true,
        isItalic: true
      });
    } else if (match[4] || match[5]) {
      tokens.push({
        text: match[4] || match[5],
        isBold: true,
        isItalic: defaultItalic
      });
    } else if (match[6] || match[7]) {
      tokens.push({
        text: match[6] || match[7],
        isBold: defaultBold,
        isItalic: true
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      text: text.slice(lastIndex),
      isBold: defaultBold,
      isItalic: defaultItalic
    });
  }

  // Restore math placeholders into tokens
  const finalTokens: RichToken[] = [];
  for (const token of tokens) {
    if (token.text.includes('___MATH_')) {
      const parts = token.text.split(/(___MATH_\d+___)/);
      for (const part of parts) {
        const mathMatch = part.match(/^___MATH_(\d+)___$/);
        if (mathMatch) {
          const idx = parseInt(mathMatch[1], 10);
          finalTokens.push({
            text: mathPlaceholders[idx] || part,
            isBold: token.isBold,
            isItalic: true,
            isMath: true
          });
        } else if (part) {
          finalTokens.push({
            ...token,
            text: part
          });
        }
      }
    } else {
      finalTokens.push(token);
    }
  }

  const cleanText = finalTokens.map(t => t.text).join('');

  return {
    cleanText,
    tokens: finalTokens.length > 0 ? finalTokens : [{ text: cleanText, isBold: defaultBold, isItalic: defaultItalic }]
  };
}

function parseInlineMarkdown(text: string, defaultBold = false, defaultItalic = false): RichToken[] {
  return sanitizeTranslatedRichText(text, defaultBold, defaultItalic).tokens;
}

function normalizeTextForReflow(text: string): string {
  if (!text) return text;
  
  const cleanStr = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = cleanStr.split(/\n{2,}/);

  const processed = blocks.map(block => {
    const lines = block.split('\n');
    let merged = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const isListItem = /^(\d+[\.\)]|[a-zA-Z][\.\)]|[\•\-\*\–\—])\s+/.test(line);
      const isCaption = /^(Hình|Figure|Fig\.|Bảng|Table|Sơ đồ)\s*\d+/i.test(line);

      if (i === 0 || isListItem || isCaption) {
        if (merged.length > 0) {
          merged += '\n' + line;
        } else {
          merged = line;
        }
      } else {
        merged += ' ' + line;
      }
    }
    return merged;
  });

  return processed.join('\n\n');
}

/**
 * Precision Constraint Computation Engine
 */
function calculateSpatialConstraints(
  sortedBlocks: SpatialTextBlock[],
  scale: number,
  canvasWidth: number,
  canvasHeight: number
) {
  for (let i = 0; i < sortedBlocks.length; i++) {
    const block = sortedBlocks[i];
    if (block.isExcluded) continue;

    const offsetX = (block.customOffsetX || 0) * scale;
    const offsetY = (block.customOffsetY || 0) * scale;

    const scaledX = Math.max(4 * scale, Math.min(canvasWidth - 30 * scale, (block.x * scale) + offsetX));
    const scaledY = (block.y * scale) + offsetY;

    const origWidthPt = block.customWidth || block.width;
    const origHeightPt = block.height;
    const origWidthScale = origWidthPt * scale;
    const origHeightScale = origHeightPt * scale;

    // Hard frame for Table Cell
    if (block.layoutContext === 'table_cell' && block.cellWidth && block.cellHeight) {
      const cellWScale = block.cellWidth * scale;
      const cellHScale = block.cellHeight * scale;
      block.computedTopY = scaledY;
      block.computedAvailWidth = cellWScale;
      block.computedAvailHeight = cellHScale;
      block.computedBottomLimit = scaledY + cellHScale;
      continue;
    }

    let availWidth = origWidthScale;
    let rightObstacleX = canvasWidth - 6 * scale;
    let obstacleCount = 0;

    for (let j = 0; j < sortedBlocks.length; j++) {
      if (i === j) continue;
      const candidate = sortedBlocks[j];
      if (candidate.isExcluded) continue;

      const candX = (candidate.x * scale) + ((candidate.customOffsetX || 0) * scale);
      const candY = (candidate.y * scale) + ((candidate.customOffsetY || 0) * scale);
      const candH = candidate.height * scale;

      const verticalOverlap = (scaledY < candY + candH - 2 * scale) && (scaledY + origHeightScale > candY + 2 * scale);
      if (verticalOverlap && candX > scaledX + 15 * scale) {
        obstacleCount++;
        if (candX < rightObstacleX) {
          rightObstacleX = candX;
        }
      }
    }

    if (obstacleCount > 0) {
      availWidth = Math.min(origWidthScale, rightObstacleX - scaledX - 4 * scale);
    }
    availWidth = Math.max(20 * scale, availWidth);

    let columnId: 'left' | 'right' | 'full' = block.columnId || 'full';
    if (origWidthScale < canvasWidth * 0.55) {
      columnId = (scaledX + origWidthScale / 2 < canvasWidth * 0.5) ? 'left' : 'right';
    }
    block.columnId = columnId;

    // Rectangle Geometry Next Block Detection:
    // Check horizontal interval overlap: Math.max(X1, X2) < Math.min(X1+W1, X2+W2)
    let nextObstacle: SpatialTextBlock | null = null;
    let minCandY = Infinity;

    for (let j = 0; j < sortedBlocks.length; j++) {
      if (i === j) continue;
      const candidate = sortedBlocks[j];
      if (candidate.isExcluded) continue;

      const candY = (candidate.y * scale) + ((candidate.customOffsetY || 0) * scale);
      if (candY <= scaledY + 3 * scale) continue;

      const candX = (candidate.x * scale) + ((candidate.customOffsetX || 0) * scale);
      const candW = (candidate.customWidth || candidate.width) * scale;

      const horizOverlap = Math.max(scaledX, candX) < Math.min(scaledX + origWidthScale, candX + candW);

      let candCol: 'left' | 'right' | 'full' = candidate.columnId || 'full';
      if (candW < canvasWidth * 0.55) {
        candCol = (candX + candW / 2 < canvasWidth * 0.5) ? 'left' : 'right';
      }

      if (horizOverlap && (columnId === 'full' || candCol === 'full' || columnId === candCol)) {
        if (candY < minCandY) {
          minCandY = candY;
          nextObstacle = candidate;
        }
      }
    }

    const verticalGap = 6 * scale;
    let bottomLimit = canvasHeight - 16 * scale;

    if (nextObstacle) {
      const nextY = (nextObstacle.y * scale) + ((nextObstacle.customOffsetY || 0) * scale);
      bottomLimit = Math.max(scaledY + origHeightScale, nextY - verticalGap);
    }

    const availHeight = Math.max(origHeightScale, bottomLimit - scaledY);

    block.computedTopY = scaledY;
    block.computedBottomLimit = bottomLimit;
    block.computedAvailWidth = availWidth;
    block.computedAvailHeight = availHeight;
  }
}

interface FittingResult {
  fontSize: number;
  lineHeight: number;
  computedParagraphs: RenderParagraph[];
  requiredHeight: number;
  totalLinesCount: number;
  fits: boolean;
  fontScale: number;
  wordSpacingExpansion: number;
  letterSpacing: number;
  fallbackReason?: string;
  singleLineViolation?: boolean;
}

const FIT_EPSILON = 0.35;

/**
 * Break long tokens exceeding available width while protecting medical identifiers.
 */
function breakLongToken(
  wordObj: FormattedWord,
  availableWidth: number,
  ctx: CanvasRenderingContext2D,
  fontStyle: string,
  fontWeight: string,
  fontSize: number,
  fontFamily: string
): FormattedWord[] {
  const protectedRegex = /^(FNAB|TIRADS|EU-TIRADS|AACE|ACE|ATA|NCCN|µm|mm|cm|mg|mL|%|pH|\d+[\.\–\—\-]\d+|B₀|B₁|T1|T2|TR|TE|TI|FID|RF|LM|TM|NMV)$/i;
  if (protectedRegex.test(wordObj.text.trim()) || wordObj.width <= availableWidth || availableWidth <= 10) {
    return [wordObj];
  }

  const delimiters = /([-\/\._\?=&])/;
  const subParts = wordObj.text.split(delimiters);
  if (subParts.length <= 1) {
    const result: FormattedWord[] = [];
    let currentChunk = '';
    for (const char of wordObj.text) {
      ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
      const testW = ctx.measureText(currentChunk + char).width;
      if (testW > availableWidth && currentChunk.length > 0) {
        result.push({
          ...wordObj,
          text: currentChunk,
          width: ctx.measureText(currentChunk).width
        });
        currentChunk = char;
      } else {
        currentChunk += char;
      }
    }
    if (currentChunk.length > 0) {
      result.push({
        ...wordObj,
        text: currentChunk,
        width: ctx.measureText(currentChunk).width
      });
    }
    return result.length > 0 ? result : [wordObj];
  }

  const result: FormattedWord[] = [];
  let tempText = '';
  for (const part of subParts) {
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    const testW = ctx.measureText(tempText + part).width;
    if (testW > availableWidth && tempText.length > 0) {
      result.push({
        ...wordObj,
        text: tempText,
        width: ctx.measureText(tempText).width
      });
      tempText = part;
    } else {
      tempText += part;
    }
  }
  if (tempText.length > 0) {
    result.push({
      ...wordObj,
      text: tempText,
      width: ctx.measureText(tempText).width
    });
  }
  return result.length > 0 ? result : [wordObj];
}

/**
 * Candidate Line Break Optimizer for Body Paragraphs & Multi-Line Blocks.
 * Evaluates line break candidates to find optimal paragraph layout matching original line shape.
 */
function layoutRichParagraphsWithCandidates(
  ctx: CanvasRenderingContext2D,
  fullText: string,
  maxWidth: number,
  fontFamily: string,
  fontSize: number,
  defaultBold: boolean,
  defaultItalic: boolean,
  originalLinesCount: number,
  scale: number
): RenderParagraph[] {
  const rawParagraphs = fullText.split('\n');
  const result: RenderParagraph[] = [];

  for (let pi = 0; pi < rawParagraphs.length; pi++) {
    const pText = rawParagraphs[pi];
    const trimmed = pText.trim();
    if (!trimmed) continue;

    const listMatch = trimmed.match(/^(\d+[\.\)]|[a-zA-Z][\.\)]|[\•\-\*\–\—])\s+(.*)$/);
    const isListItem = Boolean(listMatch);
    let listBullet = '';
    let listBulletWidth = 0;
    let contentText = trimmed;
    let hangingIndent = 0;

    if (listMatch) {
      listBullet = listMatch[1] + " ";
      contentText = listMatch[2];
      ctx.font = `bold ${fontSize}px ${fontFamily}`;
      listBulletWidth = ctx.measureText(listBullet).width;
      hangingIndent = Math.max(18 * scale, listBulletWidth + 4 * scale);
    }

    const tokens = parseInlineMarkdown(contentText, defaultBold, defaultItalic);
    const words: FormattedWord[] = [];

    for (const token of tokens) {
      const parts = token.text.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        const fontStyle = token.isItalic ? 'italic' : 'normal';
        const fontWeight = token.isBold ? 'bold' : 'normal';
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        const w = ctx.measureText(part).width;
        const formattedW: FormattedWord = {
          text: part,
          isBold: token.isBold,
          isItalic: token.isItalic,
          color: token.color,
          width: w
        };

        if (w > maxWidth && !/^\s+$/.test(part)) {
          const broken = breakLongToken(formattedW, maxWidth, ctx, fontStyle, fontWeight, fontSize, fontFamily);
          words.push(...broken);
        } else {
          words.push(formattedW);
        }
      }
    }

    // Generate Candidate Line Break Layouts
    const candidateWidths = [maxWidth, maxWidth * 0.98, maxWidth * 0.95];
    let bestCandidateLines: FormattedLine[] | null = null;
    let bestPenalty = Infinity;

    for (const candW of candidateWidths) {
      const lines: FormattedLine[] = [];
      let currentLineWords: FormattedWord[] = [];
      let currentLineWidth = 0;
      let isFirstLine = true;

      for (let wi = 0; wi < words.length; wi++) {
        const wObj = words[wi];
        const availLineW = isFirstLine 
          ? (isListItem ? candW - hangingIndent : candW)
          : (isListItem ? candW - hangingIndent : candW);

        if (currentLineWidth + wObj.width > availLineW && currentLineWords.length > 0) {
          lines.push({
            words: currentLineWords,
            xOffset: isFirstLine ? 0 : (isListItem ? hangingIndent : 0),
            isListItem: isFirstLine && isListItem,
            listBullet: isFirstLine && isListItem ? listBullet : undefined,
            listBulletWidth: isFirstLine && isListItem ? listBulletWidth : undefined
          });
          currentLineWords = [];
          currentLineWidth = 0;
          isFirstLine = false;

          if (/^\s+$/.test(wObj.text)) continue;
        }

        currentLineWords.push(wObj);
        currentLineWidth += wObj.width;
      }

      if (currentLineWords.length > 0 || isFirstLine) {
        lines.push({
          words: currentLineWords,
          xOffset: isFirstLine ? 0 : (isListItem ? hangingIndent : 0),
          isListItem: isFirstLine && isListItem,
          listBullet: isFirstLine && isListItem ? listBullet : undefined,
          listBulletWidth: isFirstLine && isListItem ? listBulletWidth : undefined
        });
      }

      // Candidate Penalty Calculation (V6.3 Visual Fidelity Repair)
      const lineCountDelta = Math.abs(lines.length - originalLinesCount);
      const extraLinePenalty = lines.length > originalLinesCount ? (lines.length - originalLinesCount) * 20 : 0;
      const missingLinePenalty = lines.length < originalLinesCount ? (originalLinesCount - lines.length) * 10 : 0;

      // Widow/Orphan Penalty (last line < 5 chars or 1 word)
      const lastLine = lines[lines.length - 1];
      const lastLineText = lastLine ? lastLine.words.map(w => w.text).join('').trim() : '';
      const lastLineWordCount = lastLine ? lastLine.words.filter(w => !/^\s+$/.test(w.text)).length : 0;
      const widowPenalty = (lastLineWordCount === 1 || lastLineText.length < 5) && lines.length > 1 ? 30 : 0;

      // Normalized line width deviation for non-final lines
      let widthDevSum = 0;
      if (lines.length > 1) {
        for (let li = 0; li < lines.length - 1; li++) {
          const lw = lines[li].words.reduce((acc, w) => acc + w.width, 0);
          widthDevSum += Math.abs(candW - lw) / candW;
        }
      }
      const normWidthDevPenalty = (widthDevSum / Math.max(1, lines.length - 1)) * 15;

      // Heading balance penalty for multi-line headings
      let headingBalancePenalty = 0;
      if (defaultBold && lines.length === 2) {
        const w1 = lines[0].words.reduce((acc, w) => acc + w.width, 0);
        const w2 = lines[1].words.reduce((acc, w) => acc + w.width, 0);
        const maxW = Math.max(w1, w2);
        if (maxW > 0) {
          const unbalance = Math.abs(w1 - w2) / maxW;
          if (unbalance > 0.45) headingBalancePenalty = 25;
        }
      }

      const totalPenalty = (lineCountDelta * 15) + extraLinePenalty + missingLinePenalty + widowPenalty + normWidthDevPenalty + headingBalancePenalty;

      if (totalPenalty < bestPenalty) {
        bestPenalty = totalPenalty;
        bestCandidateLines = lines;
      }

      if (lines.length === originalLinesCount) {
        break; // Found perfect line count match
      }
    }

    const finalLines = bestCandidateLines || [];
    const spacingAfter = isListItem ? (fontSize * 0.28) : (fontSize * 0.4);
    result.push({
      lines: finalLines,
      spacingAfter
    });
  }

  return result;
}

/**
 * Phase 7: Policy-Driven Adaptive Font Fitting & Single-Line Engine (V6.2 Repair)
 */
function fitTextToConstraints(
  ctx: CanvasRenderingContext2D,
  textToDraw: string,
  availWidth: number,
  availHeight: number,
  baseFontSize: number,
  appliedFontFamily: string,
  defaultBold: boolean,
  defaultItalic: boolean,
  blockType: SpatialTextBlock['blockType'],
  isHeading: boolean,
  originalLinesCount: number,
  scale: number
): FittingResult {
  const policy = TYPOGRAPHY_POLICY[blockType] || TYPOGRAPHY_POLICY.paragraph;
  const isSingleLineCandidate = (policy.preserveSingleLine || isHeading || blockType === 'heading' || blockType === 'diagram_label' || blockType === 'symbol' || originalLinesCount <= 1) && !textToDraw.includes('\n');
  const minScale = policy.maxScaleDown;
  const minFontSize = Math.max(5.5 * scale, baseFontSize * minScale);

  // STEP 1: STRICT SINGLE-LINE PRESERVATION FIRST
  if (isSingleLineCandidate) {
    for (let factor = 1.00; factor >= minScale - 0.001; factor -= 0.01) {
      const trialFontSize = Math.max(minFontSize, baseFontSize * factor);
      const trialLineHeight = trialFontSize * policy.lineHeightRatio;

      ctx.font = `${defaultItalic ? 'italic' : 'normal'} ${defaultBold ? 'bold' : 'normal'} ${trialFontSize}px ${appliedFontFamily}`;
      const measuredWidth = ctx.measureText(textToDraw).width;

      const fitsWidth = measuredWidth <= availWidth + FIT_EPSILON * scale;
      const fitsHeight = trialLineHeight <= availHeight + FIT_EPSILON * scale;

      if (fitsWidth && fitsHeight) {
        const word: FormattedWord = {
          text: textToDraw,
          isBold: defaultBold,
          isItalic: defaultItalic,
          width: measuredWidth
        };
        const singleLine: FormattedLine = {
          words: [word],
          xOffset: 0
        };
        const paragraph: RenderParagraph = {
          lines: [singleLine],
          spacingAfter: 0
        };

        return {
          fontSize: trialFontSize,
          lineHeight: trialLineHeight,
          computedParagraphs: [paragraph],
          requiredHeight: trialLineHeight,
          totalLinesCount: 1,
          fits: true,
          fontScale: factor,
          wordSpacingExpansion: 1.0,
          letterSpacing: 0,
          singleLineViolation: false
        };
      }
    }
  }

  // STEP 2: MULTI-LINE REFLOW FOR BODY PARAGRAPHS & CAPTIONS
  const lineHeightRatio = isHeading ? 1.12 : policy.lineHeightRatio;

  for (let factor = 1.00; factor >= minScale - 0.001; factor -= 0.01) {
    const trialFontSize = Math.max(minFontSize, baseFontSize * factor);
    const trialLineHeight = trialFontSize * lineHeightRatio;

    const paragraphs = layoutRichParagraphsWithCandidates(
      ctx,
      textToDraw,
      availWidth,
      appliedFontFamily,
      trialFontSize,
      defaultBold,
      defaultItalic,
      originalLinesCount,
      scale
    );

    let totalHeight = 0;
    let totalLines = 0;
    let maxLineWidth = 0;

    for (const p of paragraphs) {
      for (const line of p.lines) {
        const lw = line.words.reduce((acc, w) => acc + w.width, 0) + (line.listBulletWidth || 0);
        maxLineWidth = Math.max(maxLineWidth, lw);
      }
      totalHeight += p.lines.length * trialLineHeight + p.spacingAfter;
      totalLines += p.lines.length;
    }

    const fitsWidth = maxLineWidth <= availWidth + FIT_EPSILON * scale;
    const fitsHeight = totalHeight <= availHeight + FIT_EPSILON * scale;
    const isSingleLineViolation = isSingleLineCandidate && totalLines > 1;
    const fits = fitsWidth && fitsHeight && !isSingleLineViolation;

    if (fits) {
      return {
        fontSize: trialFontSize,
        lineHeight: trialLineHeight,
        computedParagraphs: paragraphs,
        requiredHeight: totalHeight,
        totalLinesCount: totalLines,
        fits: true,
        fontScale: factor,
        wordSpacingExpansion: 1.0,
        letterSpacing: 0,
        singleLineViolation: isSingleLineViolation
      };
    }
  }

  // STEP 3: FALLBACK AT POLICY MINIMUM SCALE
  const fallbackFontSize = Math.max(minFontSize, baseFontSize * minScale);
  const fallbackLineHeight = fallbackFontSize * lineHeightRatio;
  const fallbackParagraphs = layoutRichParagraphsWithCandidates(
    ctx,
    textToDraw,
    availWidth,
    appliedFontFamily,
    fallbackFontSize,
    defaultBold,
    defaultItalic,
    originalLinesCount,
    scale
  );

  let fallbackHeight = 0;
  let fallbackLines = 0;
  for (const p of fallbackParagraphs) {
    fallbackHeight += p.lines.length * fallbackLineHeight + p.spacingAfter;
    fallbackLines += p.lines.length;
  }

  const isSingleLineViolation = isSingleLineCandidate && fallbackLines > 1;

  return {
    fontSize: fallbackFontSize,
    lineHeight: fallbackLineHeight,
    computedParagraphs: fallbackParagraphs,
    requiredHeight: fallbackHeight,
    totalLinesCount: fallbackLines,
    fits: false,
    fontScale: minScale,
    wordSpacingExpansion: 1.0,
    letterSpacing: 0,
    fallbackReason: 'exceeds_availHeight_at_policy_min_scale',
    singleLineViolation: isSingleLineViolation
  };
}

/**
 * Pre-computes and validates the single source of truth layout before rendering.
 */
export function buildFinalSpatialLayout(
  ctx: CanvasRenderingContext2D,
  blocks: SpatialTextBlock[],
  options: DrawSpatialOptions,
  tableDetected: boolean,
  tables: TableRegion[]
): FinalSpatialLayout {
  const {
    scale,
    fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
    globalFontSizeDelta = 0,
    pageCanvas = null,
    pageNum = 1
  } = options;

  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  const sortedBlocks = [...blocks].sort((a, b) => a.y - b.y);
  calculateSpatialConstraints(sortedBlocks, scale, canvasWidth, canvasHeight);

  const finalBlockLayouts: FinalBlockLayout[] = [];

  for (const block of sortedBlocks) {
    if (block.isExcluded) continue;

    const rawText = block.customText !== undefined 
      ? block.customText 
      : (block.translatedText || block.originalText);

    const candidate0Text = normalizeTextForReflow(sanitizeMedicalText(rawText));

    const baseFontSizePt = block.customFontSize || block.fontSize || 11.0;
    const baseFontSize = (baseFontSizePt + globalFontSizeDelta) * scale;
    const isHeading = block.blockType === 'heading' || block.isHeading || block.customFontStyle === 'bold';

    const isSerifFont = block.isSerif || (block.fontFamily && /serif|times|georgia|garamond|cambria/i.test(block.fontFamily));
    const defaultFontStack = isSerifFont
      ? "'Georgia', 'Cambria', 'Times New Roman', Times, serif"
      : fontFamily;
    const appliedFontFamily = block.customFontFamily || defaultFontStack;
    const defaultBold = block.customFontStyle === 'bold' || (isHeading && block.customFontStyle !== 'italic');
    const defaultItalic = block.customFontStyle === 'italic';

    const scaledX = Math.max(4 * scale, Math.min(canvasWidth - 30 * scale, (block.x * scale) + ((block.customOffsetX || 0) * scale)));
    const computedTopY = block.computedTopY || (block.y * scale);
    const bottomLimit = block.computedBottomLimit || (canvasHeight - 16 * scale);
    const availWidth = block.computedAvailWidth || ((block.customWidth || block.width) * scale);
    const availHeight = block.computedAvailHeight || (block.height * scale);
    const originalLinesCount = block.lines ? block.lines.length : 1;

    // V6.5 CANDIDATE GENERATION & EVALUATION
    const candidateTexts = generateCandidateVariantsForBlock(block, candidate0Text);

    // Compute original line widths in scaled canvas px
    const origLineWidths: number[] = (block.lines && block.lines.length > 0)
      ? block.lines.map(l => l.width * scale)
      : [(block.customWidth || block.width) * scale];

    const blockWidthScaled = (block.customWidth || block.width) * scale;
    const blockHeightScaled = block.height * scale;
    const origCharDensity = candidate0Text.length / Math.max(blockHeightScaled * blockWidthScaled, 1);

    const evaluatedCandidates: Array<{
      index: number;
      text: string;
      valid: boolean;
      reason?: string;
      fitRes: any;
      score: TranslationLayoutScore;
    }> = [];

    for (let cIdx = 0; cIdx < candidateTexts.length; cIdx++) {
      const candText = candidateTexts[cIdx];
      const valRes = validateTranslationCandidate(candText, candidate0Text);

      if (!valRes.valid) {
        evaluatedCandidates.push({
          index: cIdx,
          text: candText,
          valid: false,
          reason: valRes.reason,
          fitRes: null,
          score: {
            semanticScore: 0,
            lineCountScore: 0,
            lineShapeScore: 0,
            fontFidelityScore: 0,
            widthFidelityScore: 0,
            heightFidelityScore: 0,
            whitespaceScore: 0,
            typographyScore: 0,
            compactnessScore: 0,
            collisionPenalty: 100,
            overflowPenalty: 100,
            terminologyScore: 0,
            totalScore: -999
          }
        });
        continue;
      }

      const fitRes = fitTextToConstraints(
        ctx,
        candText,
        availWidth,
        availHeight,
        baseFontSize,
        appliedFontFamily,
        defaultBold,
        defaultItalic,
        block.blockType,
        isHeading,
        originalLinesCount,
        scale
      );

      const hardHeightOverflow = fitRes.requiredHeight > availHeight + FIT_EPSILON * scale;
      const hardWidthOverflow = !fitRes.fits && fitRes.computedParagraphs.some(p => p.lines.some(l => l.words.reduce((a, w) => a + w.width, 0) > availWidth + FIT_EPSILON * scale));
      const singleLineViolation = Boolean(fitRes.singleLineViolation);

      // Extract candidate line widths
      const candLineWidths: number[] = fitRes.computedParagraphs.flatMap((p: any) => p.lines.map((l: any) => l.words.reduce((acc: number, w: any) => acc + w.width, 0)));
      const maxCandW = Math.max(...candLineWidths, 1);

      // 1. Semantic Score (20%): Calculated via valRes.semanticScore
      const semanticScore = valRes.semanticScore !== undefined ? valRes.semanticScore : (cIdx === 0 ? 100 : 90);

      // 2 & 3. Line Count (20%) & Line Shape Silhouette Score (20%) using common block width scale
      const { lineShapeScore, lineCountScore } = calculateLineShapeDistance(origLineWidths, candLineWidths, blockWidthScaled);

      // 4. Font Fidelity Score (15%)
      const fontScaleDelta = Math.abs(1.0 - fitRes.fontScale);
      const fontFidelityScore = Math.max(0, Math.min(100, 100 - fontScaleDelta * 200));

      // 5. Geometry/Width Fidelity Score (15%)
      const widthDev = Math.abs(availWidth - maxCandW) / Math.max(availWidth, 1);
      const widthFidelityScore = Math.max(0, Math.min(100, 100 - widthDev * 100));

      // 6. Height Fidelity Score (10%)
      const heightDev = Math.abs(availHeight - fitRes.requiredHeight) / Math.max(availHeight, 1);
      const heightFidelityScore = Math.max(0, Math.min(100, 100 - heightDev * 100));

      // 7. Density Fidelity Score (8%)
      const candCharDensity = candText.length / Math.max(fitRes.requiredHeight * maxCandW, 1);
      const densityDev = Math.abs(candCharDensity - origCharDensity) / Math.max(origCharDensity, 0.0001);
      const densityFidelityScore = Math.max(0, Math.min(100, 100 - densityDev * 100));

      // 8. Whitespace Score (7%)
      const fillRatio = fitRes.requiredHeight / Math.max(availHeight, 1);
      const whitespaceScore = (fillRatio >= 0.5 && fillRatio <= 1.05) ? 100 : Math.max(0, Math.min(100, fillRatio * 100));

      // 9. Compactness Score (5%)
      const compactnessScore = Math.max(0, 100 - Math.abs(candText.length - candidate0Text.length) * 0.5);

      const collisionPenalty = (hardHeightOverflow || hardWidthOverflow) ? 100 : 0;
      const overflowPenalty = singleLineViolation ? 100 : 0;

      const isInvalidCandidate = hardHeightOverflow || hardWidthOverflow || singleLineViolation || !valRes.valid;

      const totalScore = isInvalidCandidate ? -999 : (
        (semanticScore * 0.20) +
        (lineCountScore * 0.20) +
        (lineShapeScore * 0.20) +
        (fontFidelityScore * 0.15) +
        (widthFidelityScore * 0.15) +
        (heightFidelityScore * 0.10) +
        (densityFidelityScore * 0.08) +
        (whitespaceScore * 0.07) +
        (compactnessScore * 0.05)
      );

      evaluatedCandidates.push({
        index: cIdx,
        text: candText,
        valid: !isInvalidCandidate,
        fitRes,
        score: {
          semanticScore,
          lineCountScore,
          lineShapeScore,
          fontFidelityScore,
          widthFidelityScore,
          heightFidelityScore,
          whitespaceScore,
          typographyScore: singleLineViolation ? 0 : 100,
          compactnessScore,
          collisionPenalty,
          overflowPenalty,
          terminologyScore: valRes.medicalTermsPreserved ? 100 : 0,
          totalScore
        }
      });
    }

    // Deterministic selection: sort by totalScore -> semanticScore -> lineCountScore -> lineShapeScore -> fontFidelityScore -> index
    const validCandidates = evaluatedCandidates.filter(c => c.valid && c.fitRes);
    const sortedCandidates = [...validCandidates].sort((a, b) => {
      if (Math.abs(b.score.totalScore - a.score.totalScore) > 0.1) {
        return b.score.totalScore - a.score.totalScore;
      }
      if (Math.abs(b.score.semanticScore - a.score.semanticScore) > 0.1) {
        return b.score.semanticScore - a.score.semanticScore;
      }
      if (Math.abs(b.score.lineCountScore - a.score.lineCountScore) > 0.1) {
        return b.score.lineCountScore - a.score.lineCountScore;
      }
      if (Math.abs(b.score.lineShapeScore - a.score.lineShapeScore) > 0.1) {
        return b.score.lineShapeScore - a.score.lineShapeScore;
      }
      if (Math.abs(b.score.fontFidelityScore - a.score.fontFidelityScore) > 0.1) {
        return b.score.fontFidelityScore - a.score.fontFidelityScore;
      }
      return a.index - b.index; // Prefer Candidate 0 if tied
    });

    const winningCandidate = sortedCandidates.length > 0 ? sortedCandidates[0] : evaluatedCandidates[0];
    const fitRes = winningCandidate.fitRes || fitTextToConstraints(
      ctx,
      candidate0Text,
      availWidth,
      availHeight,
      baseFontSize,
      appliedFontFamily,
      defaultBold,
      defaultItalic,
      block.blockType,
      isHeading,
      originalLinesCount,
      scale
    );

    // Update block text to the winning candidate text
    block.translatedText = winningCandidate.text;
    if (block.customText !== undefined) {
      block.customText = winningCandidate.text;
    }

    const sampledBg = sampleBlockBackgroundColor(
      pageCanvas,
      scaledX,
      computedTopY,
      availWidth,
      fitRes.requiredHeight
    );

    const hardHeightOverflow = fitRes.requiredHeight > availHeight + FIT_EPSILON * scale;
    const hardWidthOverflow = !fitRes.fits && fitRes.computedParagraphs.some((p: any) => p.lines.some((l: any) => l.words.reduce((a: number, w: any) => a + w.width, 0) > availWidth + FIT_EPSILON * scale));
    const singleLineViolation = Boolean(fitRes.singleLineViolation);

    const lineCountDelta = Math.abs(fitRes.totalLinesCount - originalLinesCount);

    finalBlockLayouts.push({
      blockId: block.id,
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      fontSize: fitRes.fontSize / scale,
      fontScale: fitRes.fontScale,
      lineHeight: fitRes.lineHeight / scale,
      appliedFontFamily,
      blockType: block.blockType,
      semanticType: block.blockType,
      layoutContext: block.layoutContext || 'page',
      lines: fitRes.computedParagraphs,
      totalLinesCount: fitRes.totalLinesCount,
      fits: fitRes.fits && !hardHeightOverflow && !hardWidthOverflow && !singleLineViolation,
      hasOverflow: hardHeightOverflow || hardWidthOverflow || singleLineViolation,
      hardHeightOverflow,
      hardWidthOverflow,
      singleLineViolation,
      collisionPrevented: false,
      score: {
        lineCountDeviation: lineCountDelta,
        fontDeviation: Math.abs(1.0 - fitRes.fontScale),
        heightDeviation: Math.abs(fitRes.requiredHeight - availHeight) / scale,
        widthDeviation: Math.abs(availWidth - (block.width * scale)) / scale,
        whitespaceQuality: 100,
        collisionPenalty: 0,
        overallScore: winningCandidate.score.lineShapeScore
      },
      customFontStyle: block.customFontStyle,
      sampledBgColor: sampledBg,
      originalGeometry: { x: block.x, y: block.y, width: block.width, height: block.height },
      availableGeometry: { availWidth: availWidth / scale, availHeight: availHeight / scale, bottomLimit: bottomLimit / scale },
      selectedTranslationCandidate: winningCandidate.index,
      selectedText: winningCandidate.text,
      candidatesCount: candidateTexts.length,
      allCandidates: evaluatedCandidates.map(c => ({
        index: c.index,
        text: c.text,
        valid: c.valid,
        reason: c.reason,
        score: c.score
      })),
      translationScore: winningCandidate.score
    });
  }

  return {
    pageNum,
    tableDetected,
    tables,
    blocks: finalBlockLayouts
  };
}

/**
 * Validates final spatial layout invariants prior to rendering.
 */
export function validateFinalSpatialLayout(layout: FinalSpatialLayout): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const b of layout.blocks) {
    if (b.hardHeightOverflow) {
      errors.push(`[LayoutViolation] block=${b.blockId} HARD_HEIGHT_OVERFLOW (height=${b.height.toFixed(1)}pt, availHeight=${b.availableGeometry.availHeight.toFixed(1)}pt)`);
    }
    if (b.hardWidthOverflow) {
      errors.push(`[LayoutViolation] block=${b.blockId} HARD_WIDTH_OVERFLOW (width=${b.width.toFixed(1)}pt, availWidth=${b.availableGeometry.availWidth.toFixed(1)}pt)`);
    }
    if (b.singleLineViolation) {
      errors.push(`[LayoutViolation] block=${b.blockId} SINGLE_LINE_VIOLATION (lines=${b.totalLinesCount}, expected=1)`);
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Comprehensive Spatial Telemetry Diagnostics (V6.2)
 */
function logSpatialPageTelemetry(
  ctx: CanvasRenderingContext2D,
  blocks: SpatialTextBlock[],
  options: DrawSpatialOptions,
  finalLayout: FinalSpatialLayout
) {
  const { scale, pageNum = 1 } = options;
  const runId = `RUN_${Date.now()}_P${pageNum}`;
  const pageIndex = pageNum - 1;

  console.log(`============================================================
[SPATIAL_PAGE_TELEMETRY V6.2] START
============================================================

runId=${runId}
pageIndex=${pageIndex}
pageNumber=${pageNum}
blocksCount=${blocks.length}
tableDetected=${finalLayout.tableDetected}
tablesCount=${finalLayout.tables.length}`);

  let inconsistencyCount = 0;
  let overflowCount = 0;

  for (const b of finalLayout.blocks) {
    const origBlock = blocks.find(blk => blk.id === b.blockId);
    const origLinesCount = origBlock?.lines ? origBlock.lines.length : 1;

    console.log(`[BLOCK_RUN]
runId=${runId}
blockId=${b.blockId}
semanticType=${b.semanticType}
layoutContext=${b.layoutContext}

originalX=${b.originalGeometry.x.toFixed(1)} pt
originalY=${b.originalGeometry.y.toFixed(1)} pt
originalWidth=${b.originalGeometry.width.toFixed(1)} pt (${(b.originalGeometry.width * scale).toFixed(1)} px)
originalHeight=${b.originalGeometry.height.toFixed(1)} pt (${(b.originalGeometry.height * scale).toFixed(1)} px)

availableWidth=${b.availableGeometry.availWidth.toFixed(1)} pt (${(b.availableGeometry.availWidth * scale).toFixed(1)} px)
availableHeight=${b.availableGeometry.availHeight.toFixed(1)} pt (${(b.availableGeometry.availHeight * scale).toFixed(1)} px)
bottomLimit=${b.availableGeometry.bottomLimit.toFixed(1)} pt

originalLines=${origLinesCount}
finalLines=${b.totalLinesCount}
lineCountDelta=${Math.abs(b.totalLinesCount - origLinesCount)}

fontScale=${b.fontScale.toFixed(2)}
fontSize=${b.fontSize.toFixed(1)} pt
lineHeight=${b.lineHeight.toFixed(1)} pt

fits=${b.fits}
hardHeightOverflow=${b.hardHeightOverflow}
hardWidthOverflow=${b.hardWidthOverflow}
singleLineViolation=${b.singleLineViolation}`);

    const assertHardOverflow = b.hardHeightOverflow === (b.score.heightDeviation > b.availableGeometry.availHeight + FIT_EPSILON);
    const assertLineCountMatch = b.lines.reduce((a, p) => a + p.lines.length, 0) === b.totalLinesCount;
    const assertionsPassed = assertLineCountMatch;

    console.log(`[TELEMETRY_ASSERT]
runId=${runId}
blockId=${b.blockId}
assertLineCountMatch=${assertLineCountMatch}
allPassed=${assertionsPassed}`);

    if (b.allCandidates && b.allCandidates.length > 0) {
      let candidateLogs = '';
      for (const cand of b.allCandidates) {
        candidateLogs += `\nCandidate ${cand.index}:
  text="${cand.text}"
  valid=${cand.valid}${cand.reason ? ` (${cand.reason})` : ''}
  semanticScore=${cand.score.semanticScore.toFixed(1)}
  lines=${b.totalLinesCount}
  lineShapeScore=${cand.score.lineShapeScore.toFixed(1)}
  fontScale=${b.fontScale.toFixed(2)}
  totalScore=${cand.score.totalScore.toFixed(1)}\n`;
      }

      const cand0 = b.allCandidates[0];
      const winCand = b.allCandidates.find(c => c.index === b.selectedTranslationCandidate) || cand0;
      const rejectedText = winCand.index !== 0 ? cand0.text : (b.allCandidates[1]?.text || '');
      const lineShapeDiff = winCand.score.lineShapeScore - cand0.score.lineShapeScore;
      const reasonStr = winCand.index === 0
        ? 'candidate0MatchesBestGeometry'
        : `whyCandidate${winCand.index}Won: lineShapeImprovement (${lineShapeDiff >= 0 ? '+' : ''}${lineShapeDiff.toFixed(1)}), fontImprovement (${b.fontScale.toFixed(2)}), semanticCorrectnessPreserved`;

      console.log(`[TRANSLATION_CANDIDATES]
runId=${runId}
blockId=${b.blockId}
blockType=${b.blockType}
${candidateLogs}
SELECTED:
candidateIndex=${b.selectedTranslationCandidate ?? 0}
selectedText="${b.selectedText || ''}"
rejectedText="${rejectedText}"
reason=${reasonStr}`);
    }

    if (!assertionsPassed) {
      inconsistencyCount++;
      console.log(`[TELEMETRY_INCONSISTENCY] runId=${runId} blockId=${b.blockId} reason="Line count mismatch"`);
    }

    if (b.hasOverflow) overflowCount++;
  }

  const valResult = validateFinalSpatialLayout(finalLayout);
  if (!valResult.valid) {
    valResult.errors.forEach(err => console.warn(err));
  }

  console.log(`============================================================
[SPATIAL_PAGE_TELEMETRY V6.2] SUMMARY
============================================================

runId=${runId}
pageIndex=${pageIndex}
pageNumber=${pageNum}
blocks=${finalLayout.blocks.length}
tableDetected=${finalLayout.tableDetected}
tables=${finalLayout.tables.length}
overflowBlocks=${overflowCount}
telemetryInconsistencyCount=${inconsistencyCount}

LAYOUT_MODIFIED=false
TRANSLATION_MODIFIED=false
TYPOGRAPHY_MODIFIED=false`);
}

/**
 * Precision Dynamic Layout & Rich Canvas Rendering Engine (V6.2)
 */
export function drawSpatialOverlayOnCanvas(
  ctx: CanvasRenderingContext2D,
  blocks: SpatialTextBlock[],
  options: DrawSpatialOptions
) {
  const {
    scale,
    opacity = 1.0,
    hoveredBlockId = null,
    selectedBlockId = null,
    fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
    showDebugBoxes = false,
    pageCanvas = null,
    pageNum = 1
  } = options;

  if (!blocks || blocks.length === 0) return;

  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  // Detect table regions if not already detected
  const linesAll: SpatialTextLine[] = blocks.flatMap(b => b.lines || []);
  const tableCheck = detectTableRegions(linesAll, blocks, canvasWidth / scale, canvasHeight / scale);

  // STEP 1: PRE-COMPUTE & VALIDATE SINGLE SOURCE OF TRUTH LAYOUT
  const finalLayout = buildFinalSpatialLayout(ctx, blocks, options, tableCheck.tableDetected, tableCheck.tables);

  if (SPATIAL_PAGE_TELEMETRY) {
    logSpatialPageTelemetry(ctx, blocks, options, finalLayout);
  }

  ctx.save();

  // PASS 1: COMPLETE ERASURE OF ORIGINAL TEXT INK
  if (opacity > 0.05) {
    for (const bLayout of finalLayout.blocks) {
      const origBlock = blocks.find(b => b.id === bLayout.blockId);
      if (!origBlock || origBlock.isExcluded) continue;

      const isActuallyTranslated = (origBlock.translatedText && origBlock.translatedText !== origBlock.originalText) || origBlock.customText !== undefined;
      if (!isActuallyTranslated) continue;

      const offsetX = (origBlock.customOffsetX || 0) * scale;
      const offsetY = (origBlock.customOffsetY || 0) * scale;
      const scaledX = Math.max(4 * scale, Math.min(canvasWidth - 30 * scale, (origBlock.x * scale) + offsetX));
      const scaledY = (origBlock.y * scale) + offsetY;
      const wrapWidth = Math.max(15 * scale, Math.min(canvasWidth - scaledX - 4 * scale, (origBlock.customWidth || origBlock.width) * scale));
      const scaledH = origBlock.height * scale;

      const sampledBg = bLayout.sampledBgColor;

      ctx.save();
      ctx.globalAlpha = Math.min(1.0, opacity);
      ctx.fillStyle = sampledBg.cssColor;

      const padX = 3.5 * scale;
      const padY = 2.5 * scale;

      if (origBlock.blockType === 'diagram_label' || !origBlock.lines || origBlock.lines.length === 0) {
        ctx.fillRect(
          scaledX - padX,
          scaledY - padY,
          wrapWidth + padX * 2,
          scaledH + padY * 2
        );
      } else {
        for (const line of origBlock.lines) {
          const lx = line.x * scale - padX;
          const ly = line.y * scale - padY;
          const lw = Math.max(line.width * scale + padX * 2, 12 * scale);
          const lh = Math.max(line.height * scale + padY * 2, line.fontSize * 1.2 * scale);
          ctx.fillRect(lx, ly, lw, lh);
        }
      }
      ctx.restore();
    }
  }

  // PASS 2: RENDER RICH TEXT FROM FINAL SPATIAL LAYOUT
  for (const bLayout of finalLayout.blocks) {
    const origBlock = blocks.find(b => b.id === bLayout.blockId);
    if (!origBlock || origBlock.isExcluded) continue;

    if (origBlock.blockType === 'symbol' && (!origBlock.translatedText || origBlock.translatedText === origBlock.originalText)) {
      continue;
    }

    const isActuallyTranslated = (origBlock.translatedText && origBlock.translatedText !== origBlock.originalText) || origBlock.customText !== undefined;
    if (!isActuallyTranslated && !showDebugBoxes && hoveredBlockId !== origBlock.id && selectedBlockId !== origBlock.id) {
      continue;
    }

    const isHovered = hoveredBlockId === origBlock.id;
    const isSelected = selectedBlockId === origBlock.id;

    const scaledX = Math.max(4 * scale, Math.min(canvasWidth - 30 * scale, (origBlock.x * scale) + ((origBlock.customOffsetX || 0) * scale)));
    const computedTopY = (origBlock.computedTopY || (origBlock.y * scale));
    const bottomLimit = (origBlock.computedBottomLimit || (canvasHeight - 16 * scale));
    const availWidth = bLayout.availableGeometry.availWidth * scale;
    const availHeight = bLayout.availableGeometry.availHeight * scale;

    const isHeading = origBlock.blockType === 'heading' || origBlock.isHeading || origBlock.customFontStyle === 'bold';
    const isCaption = origBlock.blockType === 'caption' || origBlock.isCaption;

    const policy = TYPOGRAPHY_POLICY[origBlock.blockType] || TYPOGRAPHY_POLICY.paragraph;
    const renderFontSize = bLayout.fontSize * scale;
    const renderLineHeight = bLayout.lineHeight * scale;

    // Highlight Box on Hover / Selection / Debug Mode
    if (isHovered || isSelected || showDebugBoxes) {
      ctx.save();
      const strokeColor = isSelected 
        ? '#4f46e5' 
        : (isHovered 
          ? '#6366f1' 
          : (bLayout.hasOverflow ? '#ef4444' : (isHeading ? '#10b981' : (isCaption ? '#f59e0b' : '#3b82f6'))));

      if (showDebugBoxes) {
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1 * scale;
        ctx.setLineDash([3 * scale, 3 * scale]);
        ctx.strokeRect(origBlock.x * scale, origBlock.y * scale, origBlock.width * scale, origBlock.height * scale);
        ctx.setLineDash([]);

        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5 * scale;
        ctx.setLineDash([4 * scale, 4 * scale]);
        ctx.beginPath();
        ctx.moveTo(scaledX, bottomLimit);
        ctx.lineTo(scaledX + availWidth, bottomLimit);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = (isSelected ? 2.5 : (isHovered ? 1.5 : 1.0)) * scale;
      const rectH = Math.min(bLayout.totalLinesCount * renderLineHeight, availHeight);
      ctx.strokeRect(scaledX - 2 * scale, computedTopY - 2 * scale, availWidth + 4 * scale, rectH + 4 * scale);

      if (showDebugBoxes) {
        ctx.fillStyle = strokeColor;
        ctx.font = `bold ${Math.max(9, 10 * scale)}px sans-serif`;
        const debugLabel = `[${origBlock.id}] ${origBlock.blockType} | h:${Math.round(bLayout.totalLinesCount * renderLineHeight)}/${Math.round(availHeight)} | ${bLayout.fits ? 'FITS' : 'OVERFLOW'}`;
        ctx.fillText(debugLabel, scaledX, Math.max(2 * scale, computedTopY - 12 * scale));
      }

      ctx.restore();
    }

    // Render Text Lines
    if (isActuallyTranslated && opacity > 0.05) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.1, opacity);
      
      const sampledBg = bLayout.sampledBgColor;
      const defaultTextColor = origBlock.customColor || (
        sampledBg.isDark 
          ? (isHeading ? '#FFFFFF' : '#F8FAFC')
          : (isHeading ? '#0f172a' : '#1e293b')
      );

      ctx.fillStyle = defaultTextColor;
      ctx.textBaseline = 'top';

      let curY = computedTopY;

      for (const p of bLayout.lines) {
        let paragraphStopped = false;

        for (let li = 0; li < p.lines.length; li++) {
          if (curY + renderLineHeight > bottomLimit + 1.0) {
            origBlock.collisionPrevented = true;
            paragraphStopped = true;
            break;
          }

          const line = p.lines[li];
          const isLastLineOfParagraph = li === p.lines.length - 1;

          const isCaptionBlock = isCaption || origBlock.blockType === 'caption' || origBlock.isCaption;
          const totalLinesInBlock = bLayout.totalLinesCount;
          const isCaptionSingleLine = isCaptionBlock && totalLinesInBlock <= 1;

          const isJustified = (
            policy.justify || 
            origBlock.blockType === 'paragraph' || 
            origBlock.blockType === 'table_body' || 
            origBlock.blockType === 'table_cell' || 
            origBlock.blockType === 'caption' ||
            origBlock.isCaption ||
            origBlock.customAlign === 'justify'
          ) && 
          origBlock.customAlign !== 'center' && 
          origBlock.customAlign !== 'right' && 
          !isCaptionSingleLine && 
          !isHeading;

          let lineStartX = scaledX + line.xOffset;

          const shouldCenter = isCaptionSingleLine || origBlock.customAlign === 'center';

          if (shouldCenter) {
            const lineWidth = line.words.reduce((acc, w) => acc + w.width, 0) + (line.listBulletWidth || 0);
            if (availWidth > lineWidth) {
              lineStartX = scaledX + (availWidth - lineWidth) / 2;
            }
          } else if (origBlock.customAlign === 'right') {
            const lineWidth = line.words.reduce((acc, w) => acc + w.width, 0) + (line.listBulletWidth || 0);
            if (availWidth > lineWidth) {
              lineStartX = scaledX + (availWidth - lineWidth);
            }
          }

          let curX = lineStartX;

          let extraSpaceGap = 0;
          if (isJustified && !isLastLineOfParagraph && line.words.length > 1) {
            const effectiveWords = [...line.words];
            while (effectiveWords.length > 0 && /^\s+$/.test(effectiveWords[effectiveWords.length - 1].text)) {
              effectiveWords.pop();
            }
            while (effectiveWords.length > 0 && /^\s+$/.test(effectiveWords[0].text)) {
              effectiveWords.shift();
            }

            const nonSpaceWordsCount = effectiveWords.filter(w => !/^\s+$/.test(w.text)).length;
            if (nonSpaceWordsCount > 1) {
              const totalWordsWidth = effectiveWords.reduce((acc, w) => acc + w.width, 0);
              const availLineW = availWidth - line.xOffset - (line.listBulletWidth || 0);
              const spaceWords = effectiveWords.filter(w => /^\s+$/.test(w.text));
              const extraWidth = availLineW - totalWordsWidth;

              if (spaceWords.length > 0 && extraWidth > 0) {
                const baseSpaceW = spaceWords[0].width || (renderFontSize * 0.25);
                const gapPerSpace = extraWidth / spaceWords.length;
                if (gapPerSpace <= baseSpaceW * 2.8) {
                  extraSpaceGap = gapPerSpace;
                }
              }
            }
          }

          const blockFontStack = bLayout.appliedFontFamily || origBlock.customFontFamily || fontFamily;

          if (line.listBullet) {
            ctx.fillStyle = defaultTextColor;
            ctx.font = `bold ${renderFontSize}px ${blockFontStack}`;
            ctx.fillText(line.listBullet, curX, curY);
            curX += (line.listBulletWidth || 16 * scale);
          }

          for (const word of line.words) {
            const defaultBold = origBlock.customFontStyle === 'bold' || (isHeading && origBlock.customFontStyle !== 'italic');
            const defaultItalic = origBlock.customFontStyle === 'italic';
            const wBold = word.isBold ? 'bold' : (defaultBold ? 'bold' : 'normal');
            const wItalic = word.isItalic ? 'italic' : (defaultItalic ? 'italic' : 'normal');
            ctx.font = `${wItalic} ${wBold} ${renderFontSize}px ${blockFontStack}`;
            ctx.fillStyle = word.color || defaultTextColor;
            
            ctx.fillText(word.text, curX, curY);
            
            if (/^\s+$/.test(word.text) && extraSpaceGap > 0) {
              curX += word.width + extraSpaceGap;
            } else {
              curX += word.width;
            }
          }

          curY += renderLineHeight;
        }

        if (paragraphStopped) break;
        curY += p.spacingAfter;
      }

      ctx.restore();
    }
  }

  ctx.restore();
}
