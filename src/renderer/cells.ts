/**
 * Cell grid — 2D array of styled characters for terminal rendering.
 */

export type Style = {
  fg: string | null;   // color name: "red", "cyan", etc. null = default
  bg: string | null;
  bold: boolean;
  dim: boolean;
  underline: boolean;
};

export type Cell = {
  char: string;
  style: Style;
};

export const EMPTY_STYLE: Style = { fg: null, bg: null, bold: false, dim: false, underline: false };
export const EMPTY_CELL: Cell = { char: ' ', style: { ...EMPTY_STYLE } };

export function cellsEqual(a: Cell, b: Cell): boolean {
  return a.char === b.char &&
    a.style.fg === b.style.fg &&
    a.style.bg === b.style.bg &&
    a.style.bold === b.style.bold &&
    a.style.dim === b.style.dim &&
    a.style.underline === b.style.underline;
}

export class CellGrid {
  readonly width: number;
  readonly height: number;
  cells: Cell[][];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = [];
    for (let r = 0; r < height; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < width; c++) {
        row.push({ char: ' ', style: { ...EMPTY_STYLE } });
      }
      this.cells.push(row);
    }
  }

  clear(): void {
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        this.cells[r]![c] = { char: ' ', style: { ...EMPTY_STYLE } };
      }
    }
  }

  setCell(row: number, col: number, char: string, style: Style): void {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) return;
    this.cells[row]![col] = { char, style };
  }

  /**
   * Write a string into the grid at (row, col). Handles \n for line breaks.
   * Returns the number of rows consumed.
   */
  writeText(row: number, col: number, text: string, style: Style, wrapWidth?: number): number {
    const maxCol = wrapWidth ?? this.width;
    let r = row;
    let c = col;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === '\n') {
        r++;
        c = col;
        continue;
      }
      if (c >= maxCol) {
        r++;
        c = col;
      }
      if (r >= this.height) break;
      this.setCell(r, c, ch, style);
      c++;
    }
    return r - row + 1;
  }

  /**
   * Write word-wrapped text. Splits on spaces, wraps at wrapWidth.
   * Returns the number of rows consumed.
   */
  writeWrapped(row: number, col: number, text: string, style: Style, wrapWidth: number): number {
    const lines = text.split('\n');
    let r = row;
    for (const line of lines) {
      if (r >= this.height) break;
      const words = line.split(' ');
      let c = col;
      for (const word of words) {
        if (word.length === 0) continue;
        // Wrap if word doesn't fit on current line (unless at start of line)
        if (c > col && c + word.length + 1 > wrapWidth) {
          r++;
          c = col;
          if (r >= this.height) break;
        }
        // Add space before word (unless at start of line)
        if (c > col) {
          this.setCell(r, c, ' ', style);
          c++;
        }
        // Write word character by character (may still wrap if word > wrapWidth)
        for (let i = 0; i < word.length; i++) {
          if (c >= wrapWidth) {
            r++;
            c = col;
            if (r >= this.height) break;
          }
          this.setCell(r, c, word[i]!, style);
          c++;
        }
      }
      r++;
    }
    return r - row;
  }

  clone(): CellGrid {
    const g = new CellGrid(this.width, this.height);
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        const src = this.cells[r]![c]!;
        g.cells[r]![c] = { char: src.char, style: { ...src.style } };
      }
    }
    return g;
  }
}
