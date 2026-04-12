/**
 * Pure diff algorithm — no framework dependencies.
 * Extracted from DiffView.tsx so it can be used by both
 * the Ink component and the cell-level renderer.
 */

/**
 * Compute a simple unified diff between two strings.
 * Returns an array of { type, line } entries.
 */
export function computeDiff(
  oldText: string,
  newText: string,
): Array<{ type: "add" | "remove" | "context"; line: string }> {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: Array<{ type: "add" | "remove" | "context"; line: string }> = [];

  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      result.push({ type: "context", line: oldLines[oi]! });
      oi++;
      ni++;
    } else if (ni < newLines.length && (oi >= oldLines.length || !oldLines.slice(oi).includes(newLines[ni]!))) {
      result.push({ type: "add", line: newLines[ni]! });
      ni++;
    } else {
      result.push({ type: "remove", line: oldLines[oi]! });
      oi++;
    }
  }

  return result;
}

/**
 * Filter diff to show only changed lines with N lines of context.
 */
export function filterWithContext(
  diff: Array<{ type: "add" | "remove" | "context"; line: string }>,
  contextLines = 3,
): Array<{ type: "add" | "remove" | "context" | "separator"; line: string }> {
  const changed = new Set<number>();
  diff.forEach((d, i) => {
    if (d.type !== "context") {
      for (let j = Math.max(0, i - contextLines); j <= Math.min(diff.length - 1, i + contextLines); j++) {
        changed.add(j);
      }
    }
  });

  const result: Array<{ type: "add" | "remove" | "context" | "separator"; line: string }> = [];
  let lastShown = -2;

  diff.forEach((d, i) => {
    if (changed.has(i)) {
      if (i > lastShown + 1 && lastShown >= 0) {
        result.push({ type: "separator", line: "..." });
      }
      result.push(d);
      lastShown = i;
    }
  });

  return result;
}
