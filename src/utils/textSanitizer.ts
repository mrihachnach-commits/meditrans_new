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
