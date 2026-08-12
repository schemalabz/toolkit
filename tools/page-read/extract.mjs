import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';

// Below this many extracted words we treat the page as un-rendered (JS shell)
// and escalate to the browser tier. Real content pages have hundreds of words;
// a JS shell has 0–2, and 25 clears typical boilerplate ("JavaScript required",
// cookie/consent banners) without tripping on genuinely short articles.
export const THIN_WORD_COUNT = 25;

// linkedom's defaultView does not implement getComputedStyle, which defuddle
// uses for content standardization (nav/footer removal, block detection).
// Stub it so defuddle can do its job without a full browser environment.
function stubGetComputedStyle(document) {
  const view = document.defaultView;
  if (view && !view.getComputedStyle) {
    view.getComputedStyle = () => ({
      display: '',
      visibility: '',
      getPropertyValue: () => '',
    });
  }
}

export async function extract(html, url) {
  const { document } = parseHTML(html);
  stubGetComputedStyle(document);
  const r = await Defuddle(document, url, { markdown: true });
  return { markdown: String(r.content ?? '').trim(), wordCount: r.wordCount ?? 0, title: r.title ?? '' };
}

export function isThin(result) {
  return !result.markdown || result.wordCount < THIN_WORD_COUNT;
}
