const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/**
 * Build highlight HTML from match ranges (shared by the backend and demo — single source of behavior).
 * Ranges are UTF-16 code-unit offsets, exactly as the matching library returns them, so slicing the
 * string directly keeps them aligned; counting code points instead would shift every range that
 * follows an astral character (an emoji in a file name). Everything except the <mark> tags is
 * escaped, so repo/file names cannot inject scripts.
 */
export function buildHighlighted(target: string, ranges: Array<[number, number]>): string {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);

  let highlighted = "";
  let pos = 0;
  for (const [sRaw, eRaw] of sorted) {
    const s = Math.max(sRaw, pos);
    if (eRaw < pos) continue;
    highlighted +=
      escapeHtml(target.slice(pos, s)) + "<mark>" + escapeHtml(target.slice(s, eRaw + 1)) + "</mark>";
    pos = eRaw + 1;
  }
  highlighted += escapeHtml(target.slice(pos));
  return highlighted;
}
