/**
 * Utility functions for medical text formatting, LaTeX cleanup, Markdown list hierarchy normalization,
 * and robust table parsing/repair.
 */

/**
 * Completely removes raw LaTeX formatting artifacts and converts mathematical / comparison
 * expressions to clean, human-readable Unicode text.
 * Examples:
 *   "$> 50%$ đến $< 95%$" => "> 50% đến < 95%"
 *   "($> 0%$ đến $\le 2%$)" => "(> 0% đến ≤ 2%)"
 *   "$\ge 50\%$" => "≥ 50%"
 *   "$\pm 5\%$" => "± 5%"
 *   "$\approx 10\%$" => "≈ 10%"
 *   "$< 1\text{ cm}$" => "< 1 cm"
 */
export function cleanLatex(input: string): string {
  if (!input) return '';

  let text = input;

  // 1. Common LaTeX commands to Unicode symbols
  const latexSymbols: [RegExp, string][] = [
    [/\\le(?:q)?(?![a-zA-Z])/g, '≤'],
    [/\\ge(?:q)?(?![a-zA-Z])/g, '≥'],
    [/\\pm(?![a-zA-Z])/g, '±'],
    [/\\mp(?![a-zA-Z])/g, '∓'],
    [/\\times(?![a-zA-Z])/g, '×'],
    [/\\div(?![a-zA-Z])/g, '÷'],
    [/\\approx(?![a-zA-Z])/g, '≈'],
    [/\\neq(?![a-zA-Z])/g, '≠'],
    [/\\equiv(?![a-zA-Z])/g, '≡'],
    [/\\sim(?![a-zA-Z])/g, '~'],
    [/\\ll(?![a-zA-Z])/g, '≪'],
    [/\\gg(?![a-zA-Z])/g, '≫'],
    [/\\infty(?![a-zA-Z])/g, '∞'],
    [/\\degree(?![a-zA-Z])/g, '°'],
    [/\\circ(?![a-zA-Z])/g, '°'],
    [/\^\{\\circ\}|\^\\circ/g, '°'],
    [/\\cdot(?![a-zA-Z])/g, '·'],
    [/\\bullet(?![a-zA-Z])/g, '•'],
    [/\\(?:rightarrow|to)(?![a-zA-Z])/g, '→'],
    [/\\leftarrow(?![a-zA-Z])/g, '←'],
    [/\\uparrow(?![a-zA-Z])/g, '↑'],
    [/\\downarrow(?![a-zA-Z])/g, '↓'],
    [/\\leftrightarrow(?![a-zA-Z])/g, '↔'],

    // Escaped punctuation & special characters
    [/\\%/g, '%'],
    [/\\\$/g, '$'],
    [/\\_/g, '_'],
    [/\\&/g, '&'],
    [/\\#/g, '#'],

    // Spacing
    [/\\(?:quad|qquad)(?![a-zA-Z])/g, ' '],
    [/\\(?:,|;|:)/g, ' '],

    // Units & Greek letters
    [/\\mu(?:\s*m|m)?(?![a-zA-Z])/g, 'µm'],
    [/\\alpha(?![a-zA-Z])/g, 'α'],
    [/\\beta(?![a-zA-Z])/g, 'β'],
    [/\\gamma(?![a-zA-Z])/g, 'γ'],
    [/\\delta(?![a-zA-Z])/g, 'δ'],
    [/\\Delta(?![a-zA-Z])/g, 'Δ'],
    [/\\epsilon(?![a-zA-Z])/g, 'ε'],
    [/\\theta(?![a-zA-Z])/g, 'θ'],
    [/\\lambda(?![a-zA-Z])/g, 'λ'],
    [/\\sigma(?![a-zA-Z])/g, 'σ'],
    [/\\tau(?![a-zA-Z])/g, 'τ'],
    [/\\phi(?![a-zA-Z])/g, 'φ'],
    [/\\omega(?![a-zA-Z])/g, 'ω'],
  ];

  for (const [pattern, replacement] of latexSymbols) {
    text = text.replace(pattern, replacement);
  }

  // 2. Remove text wrappers like \text{...}, \mathrm{...}, \mathbf{...}, \operatorname{...}
  text = text.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1');
  text = text.replace(/\\textbf\{([^{}]*)\}/g, '**$1**');
  text = text.replace(/\\textit\{([^{}]*)\}/g, '*$1*');

  // 3. Fractions \frac{A}{B} => A/B
  text = text.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2');

  // 4. Parentheses sizing wrappers \left( \right) etc.
  text = text.replace(/\\(?:left|right)\s*([()[\]{}|.])/g, '$1');

  // 5. Remove math mode delimiters:
  // $$ ... $$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, '$1');
  // $ ... $
  text = text.replace(/\$([^$\n]+?)\$/g, '$1');
  // \( ... \)
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, '$1');
  // \[ ... \]
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, '$1');

  // 6. Clean up remaining stray backslashes before common comparison/math characters like \> or \<
  text = text.replace(/\\([><=±≤≥%])/g, '$1');

  return text;
}

/**
 * Repairs malformed Markdown tables.
 * Fixes tables where:
 * 1. The separator line `--|---|---` was merged with a bullet or with data cells on the same line.
 * 2. Table rows were concatenated without newlines (`... (pCx) 3 | dRCA ... 4 | R-PDA`).
 * 3. Leading and trailing pipes `|` were missing.
 * 4. Ensures blank lines before and after tables so Markdown parser recognizes them.
 */
export function repairMangledMarkdownTables(text: string): string {
  if (!text) return '';

  let res = text;

  // 1. Separate table separator when merged with bullets or text:
  // e.g. "• --|---|---|--- 2 | Động mạch..." => "\n|---|---|---|---|\n2 | Động mạch..."
  res = res.replace(/^[ \t]*(?:[•◦▪▫–—\-*+]\s+)?((?:-+:?\|)+-+:?)[ \t]*(.*)$/gm, (_match, sep, rest) => {
    let cleanSep = sep.trim();
    if (!cleanSep.startsWith('|')) cleanSep = `|${cleanSep}`;
    if (!cleanSep.endsWith('|')) cleanSep = `${cleanSep}|`;

    if (!rest || !rest.trim()) {
      return `\n${cleanSep}\n`;
    }
    return `\n${cleanSep}\n${rest.trim()}`;
  });

  // 2. Separate concatenated table rows:
  // Detect row indicators like " 2 | ", " 3 | ", " 4 | ", " 10 | ", " 11 | "
  res = res.replace(/([^\n|]+)\s+(\d+\s*\|)/g, '$1\n$2');
  // Detect acronyms starting next row cell, e.g. " SA | ", " SCCT | ", " SMT | ", " VSD | ", " RV | ", " LAD | "
  res = res.replace(/([^\n|]+)\s+((?:SA|SCCT|SMT|VSD|RV|LV|RA|LA|LAD|LCx|RCA)\s*\|)/g, '$1\n$2');

  // 3. Ensure table rows have leading and trailing pipes, and proper spacing
  const rawLines = res.split('\n');
  const fixedLines: string[] = [];
  let inTable = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Check if line is a table separator:
    const isSep = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(trimmed);
    const pipeCount = (trimmed.match(/\|/g) || []).length;
    const isRow = pipeCount >= 1 && !trimmed.startsWith('#') && !isSep;

    if (isSep) {
      if (!inTable) {
        fixedLines.push('');
        inTable = true;
      }
      let cleanSep = trimmed.startsWith('|') ? trimmed : `| ${trimmed}`;
      if (!cleanSep.endsWith('|')) cleanSep = `${cleanSep} |`;
      fixedLines.push(cleanSep);
      continue;
    }

    if (isRow) {
      const prevLine = i > 0 ? rawLines[i - 1].trim() : '';
      const nextLine = i < rawLines.length - 1 ? rawLines[i + 1].trim() : '';
      const isNextSep = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(nextLine);
      const isPrevSep = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(prevLine);
      const isAdjacentToTable = inTable || isSep || isNextSep || isPrevSep || prevLine.includes('|') || nextLine.includes('|');

      if (isAdjacentToTable) {
        if (!inTable && isNextSep) {
          fixedLines.push('');
          inTable = true;
        }
        let cleanRow = trimmed.replace(/^[•◦▪▫–—\-*+]\s+/, '');
        if (!cleanRow.startsWith('|')) cleanRow = `| ${cleanRow}`;
        if (!cleanRow.endsWith('|')) cleanRow = `${cleanRow} |`;
        fixedLines.push(cleanRow);
        continue;
      }
    }

    if (inTable && !isRow && !isSep) {
      fixedLines.push('');
      inTable = false;
    }

    fixedLines.push(line);
  }

  return fixedLines.join('\n');
}

/**
 * Normalizes lists and hierarchical indentation from raw text / OCR / AI output.
 * Ensures that nested items (bullet levels, dashes, sub-items, imaging modalities)
 * are accurately converted into indented Markdown sub-lists matching the original document structure.
 * CRITICAL: Completely skips table separators and table rows so they are NEVER mangled.
 */
export function normalizeMarkdownLists(input: string): string {
  if (!input) return '';

  const lines = input.split('\n');
  const resultLines: string[] = [];

  // Hierarchy tracking for flattening cases
  let hasActiveCategory = false;
  let hasActiveCondition = false;

  const modalityRegex = /^(?:[-*•◦▪▫–—]\s*)?(?:\*\*)?(Siêu âm|CT|MRI|X-quang|CLVT|CHT|PET|PET-CT|Bệnh học|Giải phẫu bệnh|Ultrasound)(?:\*\*)?[:\s]+(.*)$/i;
  const conditionRegex = /^(?:[-*•◦▪▫–—]\s*)?(.*(?::\s*(?:dưới|trên|từ|<|>|≤|≥|\d+|ít hơn|nhiều hơn)|Nang giả tụy|Ổ dịch quanh tụy|Hoại tử tụy|Viêm tụy|Áp xe|Tụ dịch).*)$/i;
  const subFeatureRegex = /^(?:[-*•◦▪▫–—]\s*)?(?:Ổ dịch (?:không có|có) vỏ bao|(?:Không có|Có) vỏ bao|Thành mỏng|Thành dày|Bờ (?:rõ|không rõ|đều|không đều)|Dạng đơn thùy|Dạng đa thùy)(.*)$/i;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // Detect leading whitespace indentation
    const indentMatch = rawLine.match(/^([ \t]*)(.*)$/);
    if (!indentMatch) {
      resultLines.push(rawLine);
      continue;
    }

    const rawIndent = indentMatch[1];
    let content = indentMatch[2];

    if (!content.trim()) {
      resultLines.push('');
      continue;
    }

    // 1. CRITICAL: Check if line is a table separator line:
    // e.g. "|---|---|", "---|---|---", "--|---|---|---", "|:---|:---|", etc.
    const isTableSeparator = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(content);
    if (isTableSeparator) {
      // Must NOT be treated as a bullet item!
      let cleanSep = content.trim();
      if (!cleanSep.startsWith('|')) cleanSep = `| ${cleanSep}`;
      if (!cleanSep.endsWith('|')) cleanSep = `${cleanSep} |`;
      resultLines.push(cleanSep);
      continue;
    }

    // 2. CRITICAL: Check if line is a table row (starts/ends with pipe or has multiple pipes):
    const pipeCount = (content.match(/\|/g) || []).length;
    const isTableRow = pipeCount >= 2 || (pipeCount === 1 && /^\s*\||\|\s*$/.test(content));
    if (isTableRow && !content.startsWith('#')) {
      // Must NOT be treated as a bullet item!
      let cleanRow = content.trim().replace(/^[•◦▪▫–—\-*+]\s+/, '');
      if (!cleanRow.startsWith('|')) cleanRow = `| ${cleanRow}`;
      if (!cleanRow.endsWith('|')) cleanRow = `${cleanRow} |`;
      resultLines.push(cleanRow);
      continue;
    }

    // Convert tabs to 2 spaces
    const spaceCount = rawIndent.replace(/\t/g, '  ').length;

    // Check if line starts with a list bullet/dash symbol:
    const bulletMatch = content.match(/^([•◦▪▫–—\-*+])\s*(.*)$/);

    if (bulletMatch) {
      const symbol = bulletMatch[1];
      const itemText = bulletMatch[2];

      // If the line already has explicit indentation (2, 4, 6, 8+ spaces):
      if (spaceCount >= 2) {
        const level = Math.floor(spaceCount / 2);
        const normalizedIndent = '  '.repeat(level);
        resultLines.push(`${normalizedIndent}- ${itemText}`);
        continue;
      }

      // If spaceCount is 0, check semantic hierarchy to prevent flat bullet lists:
      // Case 1: Imaging Modality (Siêu âm, CT, MRI, Ultrasound...)
      const modMatch = itemText.match(modalityRegex);
      if (modMatch) {
        const modName = modMatch[1];
        const rest = modMatch[2];
        resultLines.push(`      - **${modName}**: ${rest}`);
        continue;
      }

      // Case 2: Sub-feature of lesion (e.g. Ổ dịch không có vỏ bao, Thành mỏng...)
      const subFeatureMatch = itemText.match(subFeatureRegex);
      if (subFeatureMatch && (hasActiveCondition || hasActiveCategory)) {
        resultLines.push(`      - ${itemText}`);
        continue;
      }

      // Case 3: Condition / Lesion subtype (e.g. Ổ dịch quanh tụy cấp tính: dưới 4 tuần, Nang giả tụy: trên 4 tuần)
      const condMatch = itemText.match(conditionRegex);
      if (condMatch && hasActiveCategory) {
        hasActiveCondition = true;
        resultLines.push(`    - **${itemText.replace(/^\*\*/, '').replace(/\*\*$/, '')}**`);
        continue;
      }

      // Case 4: Category / Parent section (e.g. Các thể và biến chứng...)
      if (
        itemText.toLowerCase().includes('thể và biến chứng') ||
        itemText.toLowerCase().includes('biến chứng') ||
        itemText.toLowerCase().includes('phân loại') ||
        itemText.toLowerCase().includes('dấu hiệu') ||
        itemText.toLowerCase().includes('types and complications')
      ) {
        hasActiveCategory = true;
        hasActiveCondition = false;
        resultLines.push(`- **${itemText.replace(/^\*\*/, '').replace(/\*\*$/, '')}**`);
        continue;
      }

      // Default top-level item
      resultLines.push(`- ${itemText}`);
    } else {
      // Non-bullet line: If it was indented under a previous item, preserve proportional indentation
      if (spaceCount >= 2) {
        const level = Math.floor(spaceCount / 2);
        const normalizedIndent = '  '.repeat(level);
        resultLines.push(`${normalizedIndent}${content}`);
      } else {
        resultLines.push(rawLine);
      }
    }
  }

  return resultLines.join('\n');
}

/**
 * Full pre-processing pipeline for rendering medical markdown content in MediTrans.
 */
export function prepareMedicalContent(content: string): string {
  if (!content) return '';

  // Step 1: Clean raw LaTeX math expressions ($> 50%$, $\le 2%$, $\pm 5\%$, etc.)
  let text = cleanLatex(content);

  // Step 2: Repair mangled Markdown tables before list processing
  text = repairMangledMarkdownTables(text);

  // Step 3: Normalize escaped HTML br tags (&lt;br&gt; or &lt;br/&gt;) to real <br/>
  text = text.replace(/&lt;br\s*\/?&gt;/gi, '<br/>');

  // Step 4: Replace sequences of 4 or more dots with a clean ' ... '
  text = text.replace(/(\s*\.\s*){4,}/g, ' ... ');

  // Step 5: Normalize list indentation and bullet hierarchy
  text = normalizeMarkdownLists(text);

  // Step 6: Protect comparison operators (< and >) so rehype-raw doesn't swallow them as invalid HTML tags
  text = text.replace(/<(?!\/?(?:br|p|b|i|strong|em|sub|sup|table|thead|tbody|tr|td|th|ul|ol|li|span|div|code|pre)\b)/gi, '&lt;');

  return text;
}
