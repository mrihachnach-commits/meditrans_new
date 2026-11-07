/**
 * MediTrans AI Professional Word (.docx) Exporter
 * Formats translated medical documents with elegant covers, document headers,
 * clean typography, medical tables, callouts, and section headers.
 */

import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  HeadingLevel, 
  Table, 
  TableRow, 
  TableCell, 
  WidthType, 
  BorderStyle, 
  AlignmentType, 
  Header, 
  Footer, 
  PageNumber
} from 'docx';
import { saveAs } from 'file-saver';
import { prepareMedicalContent, cleanLatex } from './textFormatting';

export interface ExportWordOptions {
  currentFileName: string;
  availablePages: number[];
  translations: Record<number, { content: string; status: string }>;
  engineName?: string;
}

export interface ExportSummaryWordOptions {
  currentFileName: string;
  summaryText: string;
  summaryRangeText?: string;
}

/**
 * Parses inline markdown formatting (**bold**, *italic*, `code`) into an array of docx TextRun objects.
 */
function parseFormattedTextRuns(
  text: string, 
  baseOptions: { font?: string; size?: number; color?: string; bold?: boolean; italics?: boolean } = {}
): TextRun[] {
  const defaultFont = baseOptions.font || "Times New Roman";
  const defaultSize = baseOptions.size || 24; // 12pt (half-points)
  const defaultColor = baseOptions.color || "1E293B";

  const cleaned = cleanLatex(text);
  if (!cleaned.includes('*') && !cleaned.includes('`') && !cleaned.includes('_')) {
    return [new TextRun({
      text: cleaned,
      font: defaultFont,
      size: defaultSize,
      color: defaultColor,
      bold: baseOptions.bold || false,
      italics: baseOptions.italics || false
    })];
  }

  const runs: TextRun[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|_[^_]+_)/g;
  const parts = cleaned.split(regex);

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      runs.push(new TextRun({
        text: part.slice(2, -2),
        font: defaultFont,
        size: defaultSize,
        color: defaultColor,
        bold: true,
        italics: baseOptions.italics || false
      }));
    } else if ((part.startsWith('*') && part.endsWith('*') && part.length > 2) ||
               (part.startsWith('_') && part.endsWith('_') && part.length > 2)) {
      runs.push(new TextRun({
        text: part.slice(1, -1),
        font: defaultFont,
        size: defaultSize,
        color: defaultColor,
        bold: baseOptions.bold || false,
        italics: true
      }));
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      runs.push(new TextRun({
        text: part.slice(1, -1),
        font: "Consolas",
        size: defaultSize - 2,
        color: "0F766E",
        bold: false
      }));
    } else {
      runs.push(new TextRun({
        text: part,
        font: defaultFont,
        size: defaultSize,
        color: defaultColor,
        bold: baseOptions.bold || false,
        italics: baseOptions.italics || false
      }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({
    text: cleaned,
    font: defaultFont,
    size: defaultSize,
    color: defaultColor
  })];
}

/**
 * Builds a styled docx Table from markdown table lines.
 */
function buildDocxTable(tableLines: string[]): Table | null {
  const rowsData: string[][] = [];

  for (const line of tableLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip separator lines like |---|---| or |:---:|
    if (/^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/.test(trimmed)) {
      continue;
    }
    const rawCells = trimmed.split('|');
    if (rawCells.length > 1) {
      let cells = rawCells.map(c => c.trim());
      if (cells[0] === '') cells.shift();
      if (cells[cells.length - 1] === '') cells.pop();
      if (cells.length > 0) {
        rowsData.push(cells);
      }
    }
  }

  if (rowsData.length === 0) return null;

  const tableRows: TableRow[] = [];

  rowsData.forEach((rowCells, rowIndex) => {
    const isHeader = rowIndex === 0;

    const cells: TableCell[] = rowCells.map(cellText => {
      const runs = parseFormattedTextRuns(cellText, {
        font: "Times New Roman",
        size: isHeader ? 22 : 20,
        color: isHeader ? "FFFFFF" : "1E293B",
        bold: isHeader
      });

      return new TableCell({
        children: [
          new Paragraph({
            alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { before: 80, after: 80 },
            children: runs
          })
        ],
        shading: {
          fill: isHeader 
            ? "1E40AF" 
            : (rowIndex % 2 === 0 ? "F8FAFC" : "FFFFFF")
        },
        margins: {
          top: 100,
          bottom: 100,
          left: 140,
          right: 140
        },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
          left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
          right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        }
      });
    });

    tableRows.push(new TableRow({ children: cells }));
  });

  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE
    },
    rows: tableRows
  });
}

/**
 * Creates the document header / cover block at the top of the Word document.
 */
function createDocumentHeaderBlock(docTitle: string, subtitleBadge: string, pageRangeText: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  // Top Badge / Header Banner
  elements.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 100, after: 100 },
    children: [
      new TextRun({
        text: subtitleBadge || "BẢN DỊCH Y KHOA CHUYÊN NGHIỆP — MEDITRANS AI",
        font: "Times New Roman",
        size: 18,
        bold: true,
        color: "2563EB"
      })
    ]
  }));

  // Main Document Title / Article Header
  const titleText = (docTitle || "Tài Liệu Y Khoa").replace(/\.[^/.]+$/, "");
  elements.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 160 },
    children: [
      new TextRun({
        text: titleText,
        font: "Times New Roman",
        size: 36, // 18pt
        bold: true,
        color: "0F172A"
      })
    ]
  }));

  // Metadata Card
  const nowStr = new Date().toLocaleString('vi-VN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric'
  });

  elements.push(new Paragraph({
    spacing: { before: 0, after: 200 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 12, color: "2563EB" }
    },
    children: [
      new TextRun({
        text: `📄 Tệp gốc: `,
        font: "Times New Roman",
        size: 20,
        bold: true,
        color: "475569"
      }),
      new TextRun({
        text: `${docTitle}    |    `,
        font: "Times New Roman",
        size: 20,
        color: "334155"
      }),
      new TextRun({
        text: `📑 Phạm vi: `,
        font: "Times New Roman",
        size: 20,
        bold: true,
        color: "475569"
      }),
      new TextRun({
        text: `${pageRangeText}    |    `,
        font: "Times New Roman",
        size: 20,
        color: "334155"
      }),
      new TextRun({
        text: `🕒 Ngày tạo: `,
        font: "Times New Roman",
        size: 20,
        bold: true,
        color: "475569"
      }),
      new TextRun({
        text: `${nowStr}`,
        font: "Times New Roman",
        size: 20,
        color: "334155"
      })
    ]
  }));

  elements.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  return elements;
}

/**
 * Main Export Function to generate and save high-quality Word (.docx) files for translations.
 */
export async function exportTranslationsToWord(options: ExportWordOptions): Promise<void> {
  const { currentFileName, availablePages, translations } = options;

  if (!availablePages || availablePages.length === 0) {
    throw new Error("Không có trang nào được chọn để xuất Word.");
  }

  const pageRangeText = availablePages.length === 1 
    ? `Trang ${availablePages[0]}`
    : `Trang ${availablePages[0]} - ${availablePages[availablePages.length - 1]} (Tổng ${availablePages.length} trang)`;

  const docTitle = currentFileName || "Tai_Lieu_Y_Khoa.pdf";
  const allElements: (Paragraph | Table)[] = [];

  // Add Document Title / Header Block
  allElements.push(...createDocumentHeaderBlock(docTitle, "BẢN DỊCH Y KHOA CHUYÊN NGHIỆP — MEDITRANS AI", pageRangeText));

  // Process each page content
  for (let i = 0; i < availablePages.length; i++) {
    const pageNum = availablePages[i];
    const rawContent = translations[pageNum]?.content;
    if (!rawContent) continue;

    // Add Page Banner if multi-page export
    if (availablePages.length > 1) {
      allElements.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 300, after: 160 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" }
        },
        children: [
          new TextRun({
            text: `--- TRANG ${pageNum} ---`,
            bold: true,
            color: "2563EB",
            size: 22,
            font: "Times New Roman"
          })
        ]
      }));
    }

    const preparedContent = prepareMedicalContent(rawContent);
    const lines = preparedContent.split('\n');
    let currentTableLines: string[] = [];

    const flushTable = () => {
      if (currentTableLines.length > 0) {
        const table = buildDocxTable(currentTableLines);
        if (table) {
          allElements.push(table);
          allElements.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        }
        currentTableLines = [];
      }
    };

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      const trimmed = line.trim();

      // Check if line is part of a markdown table
      if (trimmed.includes('|') && (trimmed.startsWith('|') || trimmed.endsWith('|') || trimmed.split('|').length >= 3)) {
        currentTableLines.push(line);
        continue;
      } else {
        flushTable();
      }

      if (!trimmed) {
        allElements.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }));
        continue;
      }

      // Blockquote / Medical Note
      if (trimmed.startsWith('> ')) {
        const quoteText = trimmed.replace(/^>\s*/, '');
        const runs = parseFormattedTextRuns(quoteText, {
          font: "Times New Roman",
          size: 24,
          color: "1E3A8A",
          italics: true
        });

        allElements.push(new Paragraph({
          spacing: { before: 120, after: 120 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 18, color: "2563EB" }
          },
          indent: { left: 360 },
          children: runs
        }));
        continue;
      }

      // Headings
      let headingLevelVal: (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined;
      let headingSize = 24;
      let headingColor = "1E293B";
      let cleanHeadingText = trimmed;

      if (trimmed.startsWith('#### ')) {
        cleanHeadingText = trimmed.replace('#### ', '');
        headingLevelVal = HeadingLevel.HEADING_4;
        headingSize = 26; // 13pt
        headingColor = "334155";
      } else if (trimmed.startsWith('### ')) {
        cleanHeadingText = trimmed.replace('### ', '');
        headingLevelVal = HeadingLevel.HEADING_3;
        headingSize = 28; // 14pt
        headingColor = "1E40AF";
      } else if (trimmed.startsWith('## ')) {
        cleanHeadingText = trimmed.replace('## ', '');
        headingLevelVal = HeadingLevel.HEADING_2;
        headingSize = 32; // 16pt
        headingColor = "1E3A8A";
      } else if (trimmed.startsWith('# ')) {
        cleanHeadingText = trimmed.replace('# ', '');
        headingLevelVal = HeadingLevel.HEADING_1;
        headingSize = 36; // 18pt
        headingColor = "0F172A";
      }

      if (headingLevelVal !== undefined) {
        const runs = parseFormattedTextRuns(cleanHeadingText, {
          font: "Times New Roman",
          size: headingSize,
          color: headingColor,
          bold: true
        });

        allElements.push(new Paragraph({
          heading: headingLevelVal,
          spacing: { before: 240, after: 120 },
          children: runs
        }));
        continue;
      }

      // Bullet Lists & Numbered Lists
      const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('+ ');
      const isNumbered = /^\d+\.\s+/.test(trimmed);

      if (isBullet || isNumbered) {
        const leadingSpaces = line.match(/^[ \t]*/)?.[0]?.replace(/\t/g, '  ').length || 0;
        const indentLevel = Math.min(3, Math.floor(leadingSpaces / 2));
        const listText = isBullet 
          ? trimmed.replace(/^[-*+]\s+/, '') 
          : trimmed.replace(/^\d+\.\s+/, '');

        const runs = parseFormattedTextRuns(listText, {
          font: "Times New Roman",
          size: 24,
          color: "1E293B"
        });

        allElements.push(new Paragraph({
          bullet: isBullet ? { level: indentLevel } : undefined,
          indent: isNumbered ? { left: 360 * (indentLevel + 1), hanging: 240 } : undefined,
          spacing: { before: 60, after: 80 },
          children: runs
        }));
        continue;
      }

      // Standard Paragraph
      const runs = parseFormattedTextRuns(trimmed, {
        font: "Times New Roman",
        size: 24, // 12pt
        color: "1E293B"
      });

      allElements.push(new Paragraph({
        spacing: { before: 60, after: 100 },
        children: runs
      }));
    }

    flushTable();
  }

  // Section Header & Footer setup
  const titleWithoutExt = docTitle.replace(/\.[^/.]+$/, "");
  const docHeader = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 100 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }
        },
        children: [
          new TextRun({
            text: `MediTrans AI  |  ${titleWithoutExt}`,
            font: "Times New Roman",
            size: 18,
            color: "64748B",
            italics: true
          })
        ]
      })
    ]
  });

  const docFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 100 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }
        },
        children: [
          new TextRun({
            text: "Trang ",
            font: "Times New Roman",
            size: 18,
            color: "64748B"
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            font: "Times New Roman",
            size: 18,
            color: "64748B"
          }),
          new TextRun({
            text: " / ",
            font: "Times New Roman",
            size: 18,
            color: "64748B"
          }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            font: "Times New Roman",
            size: 18,
            color: "64748B"
          })
        ]
      })
    ]
  });

  const doc = new Document({
    sections: [{
      headers: { default: docHeader },
      footers: { default: docFooter },
      properties: {
        page: {
          margin: {
            top: 1440,
            bottom: 1440,
            left: 1440,
            right: 1440
          }
        }
      },
      children: allElements,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const outFileName = availablePages.length === 1 
    ? `BanDich_MediTrans_${titleWithoutExt}_Trang_${availablePages[0]}.docx` 
    : `BanDich_MediTrans_${titleWithoutExt}_${availablePages.length}_Trang.docx`;

  saveAs(blob, outFileName);
}

/**
 * Export summary text to styled Word (.docx) document.
 */
export async function exportSummaryToWord(options: ExportSummaryWordOptions): Promise<void> {
  const { currentFileName, summaryText, summaryRangeText = 'Tóm tắt nội dung' } = options;

  if (!summaryText) {
    throw new Error("Không có nội dung tóm tắt để xuất.");
  }

  const docTitle = currentFileName || "Tai_Lieu_Y_Khoa.pdf";
  const allElements: (Paragraph | Table)[] = [];

  allElements.push(...createDocumentHeaderBlock(docTitle, "BẢN TÓM TẮT Y KHOA — MEDITRANS AI", summaryRangeText));

  const preparedContent = prepareMedicalContent(summaryText);
  const lines = preparedContent.split('\n');
  let currentTableLines: string[] = [];

  const flushTable = () => {
    if (currentTableLines.length > 0) {
      const table = buildDocxTable(currentTableLines);
      if (table) {
        allElements.push(table);
        allElements.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      }
      currentTableLines = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.includes('|') && (trimmed.startsWith('|') || trimmed.endsWith('|') || trimmed.split('|').length >= 3)) {
      currentTableLines.push(line);
      continue;
    } else {
      flushTable();
    }

    if (!trimmed) {
      allElements.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }));
      continue;
    }

    let headingLevelVal: (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined;
    let headingSize = 24;
    let headingColor = "1E293B";
    let cleanHeadingText = trimmed;

    if (trimmed.startsWith('### ')) {
      cleanHeadingText = trimmed.replace('### ', '');
      headingLevelVal = HeadingLevel.HEADING_3;
      headingSize = 28;
      headingColor = "1E40AF";
    } else if (trimmed.startsWith('## ')) {
      cleanHeadingText = trimmed.replace('## ', '');
      headingLevelVal = HeadingLevel.HEADING_2;
      headingSize = 32;
      headingColor = "1E3A8A";
    } else if (trimmed.startsWith('# ')) {
      cleanHeadingText = trimmed.replace('# ', '');
      headingLevelVal = HeadingLevel.HEADING_1;
      headingSize = 36;
      headingColor = "0F172A";
    }

    if (headingLevelVal !== undefined) {
      const runs = parseFormattedTextRuns(cleanHeadingText, {
        font: "Times New Roman",
        size: headingSize,
        color: headingColor,
        bold: true
      });

      allElements.push(new Paragraph({
        heading: headingLevelVal,
        spacing: { before: 240, after: 120 },
        children: runs
      }));
      continue;
    }

    const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
    if (isBullet) {
      const runs = parseFormattedTextRuns(trimmed.replace(/^[-*]\s+/, ''), {
        font: "Times New Roman",
        size: 24,
        color: "1E293B"
      });

      allElements.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { before: 60, after: 80 },
        children: runs
      }));
      continue;
    }

    const runs = parseFormattedTextRuns(trimmed, {
      font: "Times New Roman",
      size: 24,
      color: "1E293B"
    });

    allElements.push(new Paragraph({
      spacing: { before: 60, after: 100 },
      children: runs
    }));
  }

  flushTable();

  const titleWithoutExt = docTitle.replace(/\.[^/.]+$/, "");
  const docHeader = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 100 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }
        },
        children: [
          new TextRun({
            text: `MediTrans AI Tóm Tắt  |  ${titleWithoutExt}`,
            font: "Times New Roman",
            size: 18,
            color: "64748B",
            italics: true
          })
        ]
      })
    ]
  });

  const docFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 100 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }
        },
        children: [
          new TextRun({
            text: "Trang ",
            font: "Times New Roman",
            size: 18,
            color: "64748B"
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            font: "Times New Roman",
            size: 18,
            color: "64748B"
          }),
          new TextRun({
            text: " / ",
            font: "Times New Roman",
            size: 18,
            color: "64748B"
          }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            font: "Times New Roman",
            size: 18,
            color: "64748B"
          })
        ]
      })
    ]
  });

  const doc = new Document({
    sections: [{
      headers: { default: docHeader },
      footers: { default: docFooter },
      properties: {
        page: {
          margin: {
            top: 1440,
            bottom: 1440,
            left: 1440,
            right: 1440
          }
        }
      },
      children: allElements,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `TomTat_MediTrans_${titleWithoutExt}.docx`);
}
