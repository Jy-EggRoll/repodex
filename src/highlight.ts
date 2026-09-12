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

/** 用匹配区间拼高亮 HTML（后端与 demo 共用，行为唯一来源）。除 <mark> 标签外全部转义，防止仓库/文件名注入脚本。 */
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
