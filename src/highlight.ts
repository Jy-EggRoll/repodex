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

/** Build highlight HTML from match ranges (shared by the backend and demo — single source of behavior). Everything except the <mark> tags is escaped, so repo/file names cannot inject scripts. */
export function buildHighlighted(target: string, ranges: Array<[number, number]>): string {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const chars = Array.from(target);

  let highlighted = "";
  let pos = 0;
  for (const [sRaw, eRaw] of sorted) {
    const s = Math.max(sRaw, pos);
    if (eRaw < pos) continue;
    highlighted +=
      escapeHtml(chars.slice(pos, s).join("")) +
      "<mark>" +
      escapeHtml(chars.slice(s, eRaw + 1).join("")) +
      "</mark>";
    pos = eRaw + 1;
  }
  highlighted += escapeHtml(chars.slice(pos).join(""));
  return highlighted;
}
