// Playwright is provided by the nix wrapper via process.env.PLAYWRIGHT (not an npm dep).
let _P;
async function pw() {
  if (!_P) { const m = await import(process.env.PLAYWRIGHT); _P = m.default ?? m; }
  return _P;
}

// Cheap HTTP tier — NO browser.
export async function fetchHttp(url) {
  const { request } = await pw();
  const ctx = await request.newContext();
  try {
    const resp = await ctx.get(url, { timeout: 20000 });
    return { ok: resp.ok(), status: resp.status(), html: await resp.text() };
  } finally { await ctx.dispose(); }
}

// Browser tier — renders JS.
export async function fetchBrowser(url) {
  const { chromium } = await pw();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1500);
    return { ok: true, status: 200, html: await page.content() };
  } finally { await browser.close(); }
}
