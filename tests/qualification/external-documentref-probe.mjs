import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

let chromium;
try { ({chromium} = await import('playwright-core')); }
catch { throw new Error('BLOCKED: install the pinned Playwright dependency before running this disposable probe.'); }

const pagePath = fileURLToPath(new URL('../../docs/research/probes/issue-56-external-documentref/index.html', import.meta.url));
const html = await readFile(pagePath);
const server = createServer((request, response) => {
  if (request.url !== '/' && request.url !== '/index.html') { response.writeHead(404).end(); return; }
  response.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Probe server did not bind a TCP address.');

const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`);
  const panel = page.getByTestId('detail-panel');
  assert.equal(await panel.isHidden(), true, 'Detail panel should not be visible before selecting the reference.');
  await page.getByTestId('documentref-cell').click();
  assert.equal(await panel.isVisible(), true, 'Reference cell should open the lightweight detail panel.');

  const initialLocator = await page.getByTestId('locator').textContent();
  await page.getByTestId('rename').click();
  assert.equal(await page.getByTestId('locator').textContent(), initialLocator, 'Renaming a display label must not retarget the reference.');
  assert.match(await page.getByTestId('state-note').textContent(), /locator is unchanged/i);

  await page.getByTestId('provider-advance').click();
  assert.equal(await page.getByTestId('currentness').textContent(), 'Stale');
  assert.match(await page.getByTestId('state-note').textContent(), /Review externally/i);
  await page.getByTestId('checkpoint-record').click();
  assert.equal(await page.getByTestId('currentness').textContent(), 'Matched');
  assert.match(await page.getByTestId('state-note').textContent(), /No Git commit was created/i);

  await page.getByTestId('permission-denied').click();
  assert.equal(await page.getByTestId('currentness').textContent(), 'Permission denied');
  assert.match(await page.getByTestId('state-note').textContent(), /unknown, not current/i);
  await page.getByTestId('unavailable').click();
  assert.equal(await page.getByTestId('currentness').textContent(), 'Unavailable');
  assert.match(await page.getByTestId('state-note').textContent(), /not presented as current/i);

  const target = page.getByTestId('open-externally');
  assert.equal(await target.getAttribute('href'), initialLocator, 'Open externally must use the reference locator.');
  assert.equal(await target.getAttribute('target'), '_blank');
  assert.equal(await target.getAttribute('rel'), 'noreferrer');
  console.log(JSON.stringify({case: 'issue-56-external-documentref-probe', status: 'PASS'}));
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
