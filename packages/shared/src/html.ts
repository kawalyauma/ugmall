/**
 * Allow-list HTML sanitizer for product descriptions (imported sheets and the
 * admin editor). Only simple formatting tags survive and ALL attributes are
 * dropped, so no scripts, event handlers, styles or links can get through.
 * Browser-safe and dependency-free.
 */
const ALLOWED = new Set(["p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "u", "h3", "h4", "h5", "table", "thead", "tbody", "tr", "td", "th", "span"]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;

export function sanitizeHtml(input: string): string {
  const src = input.replace(/<!--[\s\S]*?-->/g, "").replace(DROP_WITH_CONTENT, "");
  let out = "";
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|<|>|&(?![a-zA-Z]{2,8};|#\d{1,6};|#x[0-9a-fA-F]{1,6};)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out += src.slice(last, m.index);
    last = re.lastIndex;
    const tok = m[0];
    if (tok === "<") out += "&lt;";
    else if (tok === ">") out += "&gt;";
    else if (tok === "&") out += "&amp;";
    else {
      const name = m[1]!.toLowerCase();
      if (!ALLOWED.has(name)) continue;
      if (name === "br") out += "<br>";
      else out += tok.startsWith("</") ? `</${name}>` : `<${name}>`;
    }
  }
  out += src.slice(last);
  return out.trim();
}

export function looksLikeHtml(s: string | null | undefined): boolean {
  return !!s && /<(p|br|ul|ol|li|strong|b|em|h[3-5]|table)\b/i.test(s);
}

/** Plain-text version (meta descriptions, WhatsApp, search). */
export function htmlToText(s: string): string {
  return s
    .replace(/<\/(p|li|h[3-5]|tr)>|<br>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
