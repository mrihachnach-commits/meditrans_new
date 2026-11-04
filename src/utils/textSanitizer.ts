/**
 * Sanitizes raw LaTeX math notation (e.g. `$ > 50% $`, `$\le 2%$`, `\le`, `\ge`, `\%`, `\lt`, `\gt`, `\times`)
 * into clean, human-readable Unicode text for proper Markdown rendering.
 */
export function cleanMarkdownLatexMath(text: string | null | undefined): string {
  if (!text) return '';

  let cleaned = String(text);

  // 1. Clean block math $$...$$
  cleaned = cleaned.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_, inner) => {
    return cleanLatexSymbols(inner);
  });

  // 2. Clean inline math $...$
  cleaned = cleaned.replace(/\$\s*([^$\n]+?)\s*\$/g, (_, inner) => {
    return cleanLatexSymbols(inner);
  });

  // 3. Clean any remaining standalone LaTeX symbols outside math dollar delimiters
  cleaned = cleanLatexSymbols(cleaned);

  return cleaned;
}

function cleanLatexSymbols(input: string): string {
  if (!input) return '';
  let s = input;

  // Replace common LaTeX relational/math commands with Unicode equivalents
  s = s.replace(/\\le\b|\\leq\b/g, '≤');
  s = s.replace(/\\ge\b|\\geq\b/g, '≥');
  s = s.replace(/\\lt\b/g, '<');
  s = s.replace(/\\gt\b/g, '>');
  s = s.replace(/\\%|\\percent\b/g, '%');
  s = s.replace(/\\times\b/g, '×');
  s = s.replace(/\\pm\b/g, '±');
  s = s.replace(/\\approx\b/g, '≈');
  s = s.replace(/\\ne\b|\\neq\b/g, '≠');
  s = s.replace(/\\mu\b/g, 'μ');
  s = s.replace(/\\alpha\b/g, 'α');
  s = s.replace(/\\beta\b/g, 'β');
  s = s.replace(/\\degree\b|\^\{\s*\\circ\s*\}|\^\s*\\circ/g, '°');
  s = s.replace(/\\rightarrow\b|\\to\b/g, '→');
  s = s.replace(/\\leftarrow\b/g, '←');
  s = s.replace(/\\Delta\b/g, 'Δ');
  s = s.replace(/\\cdot\b/g, '·');

  // Strip accidental escaping backslashes before special characters like \$ or \_ or \#
  s = s.replace(/\\([_#&])/g, '$1');

  return s;
}

/**
 * Normalizes multi-level nested bullet lists and indentation for Markdown.
 * - Converts tabs to spaces (2 spaces per tab level) for standard Markdown indentation.
 * - Converts Unicode bullet characters (•, ▪, ▫, –, —) at the start of a line into standard Markdown hyphens (- )
 *   while strictly preserving leading spaces and tabs (2, 4, 6 spaces per nesting level).
 * - Ensures parent-child indentation is recognized properly by ReactMarkdown and remarkGfm.
 */
export function normalizeMarkdownBulletsAndHierarchy(text: string | null | undefined): string {
  if (!text) return '';

  const lines = text.split(/\r?\n/);
  const resultLines: string[] = [];
  let inListContext = false;
  let previousIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // If completely empty line
    if (!rawLine.trim()) {
      // Don't accumulate multiple blank lines within a list to avoid breaking nested structure
      if (inListContext) {
        if (resultLines.length > 0 && resultLines[resultLines.length - 1] === '') {
          continue;
        }
      }
      resultLines.push('');
      continue;
    }

    // Convert leading tabs to 2 spaces for standard Markdown indentation
    const expanded = rawLine.replace(/^\t+/, (match) => '  '.repeat(match.length));

    // Match leading whitespace + bullet symbol (•, ▪, ▫, ◦, ⁃, –, —, *) + content
    const bulletMatch = expanded.match(/^(\s*)([•▪▫◦⁃–—*]|-)\s+(.*)$/);
    if (bulletMatch) {
      const rawSpaces = bulletMatch[1].length;
      const content = bulletMatch[3];
      
      // Normalize space count to even 2-space increments (0, 2, 4, 6, 8, ...)
      let normalizedSpaces = 0;
      if (rawSpaces >= 8) normalizedSpaces = 8;
      else if (rawSpaces >= 6) normalizedSpaces = 6;
      else if (rawSpaces >= 4) normalizedSpaces = 4;
      else if (rawSpaces >= 2) normalizedSpaces = 2;
      else normalizedSpaces = 0;

      const indentStr = ' '.repeat(normalizedSpaces);
      resultLines.push(`${indentStr}- ${content}`);
      inListContext = true;
      previousIndent = normalizedSpaces;
      continue;
    }

    // Check if line is indented without bullet but within a list context (sub-category description)
    const indentedNonBullet = expanded.match(/^(\s{2,})([A-Za-z0-9\u00C0-\u1EF9].*)$/);
    if (indentedNonBullet && inListContext) {
      const rawSpaces = indentedNonBullet[1].length;
      const content = indentedNonBullet[2];
      
      // If it resembles an unbulleted subsection header or imaging modality (e.g. "Interstitial edematous", "Ultrasound", "CT", "MRI")
      let normalizedSpaces = Math.max(2, Math.floor(rawSpaces / 2) * 2);
      const indentStr = ' '.repeat(normalizedSpaces);
      
      // Format as indented bullet item to maintain structural hierarchy
      resultLines.push(`${indentStr}- ${content}`);
      previousIndent = normalizedSpaces;
      continue;
    }

    // Non-list line
    inListContext = false;
    previousIndent = 0;
    resultLines.push(expanded);
  }

  return resultLines.join('\n');
}

/**
 * Full sanitizer combining LaTeX math cleanup and nested list hierarchy normalization.
 */
export function sanitizeMarkdownText(text: string | null | undefined): string {
  if (!text) return '';
  const cleanedMath = cleanMarkdownLatexMath(text);
  return normalizeMarkdownBulletsAndHierarchy(cleanedMath);
}
