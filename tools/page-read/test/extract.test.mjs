import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, isThin } from '../extract.mjs';

const ARTICLE = '<html><head><title>Doc</title></head><body><nav>menu</nav>' +
  '<article><h1>Hello</h1><p>World body text for extraction here. This article has enough real ' +
  'sentences to clear the thin threshold, describing a topic across several lines so the extracted ' +
  'word count comfortably exceeds the boilerplate cutoff used to detect unrendered pages.</p>' +
  '<ul><li>one</li><li>two</li></ul></article><footer>foot</footer></body></html>';
const SHELL = '<html><head><title>App</title></head><body><div id="root"></div><script>/*spa*/</script></body></html>';

test('extract returns markdown, wordCount, title from real content', async () => {
  const r = await extract(ARTICLE, 'https://x.test');
  assert.match(r.markdown, /## Hello/);
  assert.match(r.markdown, /World body text/);
  assert.doesNotMatch(r.markdown, /menu|foot/); // nav/footer stripped
  assert.ok(r.wordCount >= 25);
  assert.equal(r.title, 'Doc');
});

test('isThin is false for a real article, true for a JS shell', async () => {
  const article = await extract(ARTICLE, 'https://x.test');
  const shell = await extract(SHELL, 'https://x.test');
  assert.equal(isThin(article), false);
  assert.equal(isThin(shell), true);
});
