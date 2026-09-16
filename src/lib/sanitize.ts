import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "u", "s", "a", "ul", "ol", "li",
  "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6",
  "img", "hr", "table", "thead", "tbody", "tr", "th", "td", "mark",
  "sub", "sup", "span", "div",
];
const ALLOWED_ATTR = ["href", "target", "rel", "title", "alt", "src", "class", "colspan", "rowspan", "data-intent", "data-note"];

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}
