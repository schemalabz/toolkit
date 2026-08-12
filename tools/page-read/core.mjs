import { fetchHttp, fetchBrowser } from './fetch.mjs';
import { extract, isThin } from './extract.mjs';

// Read a URL as markdown: try the cheap HTTP tier first, escalate to a rendered
// browser only when the extracted content looks like an un-rendered JS shell.
export async function read(url) {
  const http = await fetchHttp(url);
  if (http.ok) {
    const ex = await extract(http.html, url);
    if (!isThin(ex)) return { markdown: ex.markdown, title: ex.title, tier: 'http' };
  }
  const br = await fetchBrowser(url);
  const ex = await extract(br.html, url);
  return { markdown: ex.markdown, title: ex.title, tier: 'browser' };
}
