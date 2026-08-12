// Usage: playwright-run .github/smoke/playwright-smoke.mjs
// Proves the nix-provided Chromium actually launches and renders on this platform.
const pw = await import(process.env.PLAYWRIGHT);
const { chromium } = pw.default ?? pw;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
const title = await page.title();
await browser.close();

if (title !== 'Example Domain') {
  console.error(`FAIL: expected "Example Domain", got "${title}"`);
  process.exit(1);
}
console.log('OK: chromium launched and rendered');
