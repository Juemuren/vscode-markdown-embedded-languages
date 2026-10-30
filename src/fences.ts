export interface Fence {
  alias: string;
  startLine: number;
  endLine: number;
}

/** endLine is exclusive. Only ordinary (possibly up to three spaces indented) fences are supported. */
export function parseFences(text: string): Fence[] {
  const lines = text.split(/\r?\n/);
  const fences: Fence[] = [];
  let open: { alias: string; marker: string; count: number; startLine: number } | undefined;

  for (let line = 0; line < lines.length; line++) {
    const value = lines[line];
    if (open) {
      const close = /^(?: {0,3})(`+|~+)[ \t]*$/.exec(value);
      if (close && close[1][0] === open.marker && close[1].length >= open.count) {
        fences.push({ alias: open.alias, startLine: open.startLine, endLine: line });
        open = undefined;
      }
      continue;
    }

    const match = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(value);
    if (!match || (match[1][0] === '`' && match[2].includes('`'))) continue;
    const alias = match[2].trim().split(/[ \t{]/, 1)[0];
    if (!alias) continue;
    open = { alias, marker: match[1][0], count: match[1].length, startLine: line + 1 };
  }

  if (open) fences.push({ alias: open.alias, startLine: open.startLine, endLine: lines.length });
  return fences;
}

/** Preserve every line and column, so provider ranges map directly onto Markdown. */
export function maskedContent(text: string, fence: Fence): string {
  return text.split(/(\r?\n)/).map((part, index) => {
    if (index % 2) return part;
    const line = index / 2;
    return line >= fence.startLine && line < fence.endLine ? part : part.replace(/[^\t]/g, ' ');
  }).join('');
}
