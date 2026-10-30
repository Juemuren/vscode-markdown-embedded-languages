import MarkdownIt from 'markdown-it';

export interface Fence {
  alias: string;
  startLine: number;
  endLine: number;
  contentStartColumns: number[];
}

const parser = new MarkdownIt();

/** Parse fenced blocks using CommonMark rules. endLine is exclusive. */
export function parseFences(text: string): Fence[] {
  const sourceLines = text.split(/\r?\n/);
  return parser.parse(text, {}).flatMap((token): Fence[] => {
    if (token.type !== 'fence' || !token.map) return [];
    const alias = token.info.trim().split(/[ \t{]/, 1)[0];
    if (!alias) return [];

    const contentLines = token.content.split('\n');
    if (token.content.endsWith('\n')) contentLines.pop();
    if (!token.content) contentLines.length = 0;
    const startLine = token.map[0] + 1;
    const contentStartColumns = contentLines.map((content, index) => {
      const source = sourceLines[startLine + index] ?? '';
      const column = source.lastIndexOf(content);
      return column < 0 ? 0 : column;
    });
    return [{ alias, startLine, endLine: startLine + contentLines.length, contentStartColumns }];
  });
}

/** Preserve source positions while removing Markdown structure outside the fence body. */
export function maskedContent(text: string, fence: Fence): string {
  return text.split(/(\r?\n)/).map((part, index) => {
    if (index % 2) return part;
    const line = index / 2;
    if (line < fence.startLine || line >= fence.endLine) return part.replace(/[^\t]/g, ' ');
    const start = fence.contentStartColumns[line - fence.startLine];
    return part.slice(0, start).replace(/[^\t]/g, ' ') + part.slice(start);
  }).join('');
}
