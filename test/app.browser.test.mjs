// Browser tests for the site, run with:
//   node --test "test/*.test.mjs"
// They drive the real page in headless Chromium through Playwright, and are
// skipped where Playwright isn't installed (as in CI). The page reports each
// flow's state on <html> (data-workspace, data-image, data-share, data-print,
// data-wallpapers; see README → "State machines"), so tests wait on those
// rather than on timings. In CI (CI is set) a missing Playwright is a
// failure, not a skip.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

let playwright = null;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch {
  // Not installed: the tests below are skipped.
}

// Serves the repo the way GitHub Pages serves the site.
function serve() {
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('colourio in a browser', { skip: !playwright && !process.env.CI && 'Playwright is not installed' }, () => {
  let server;
  let browser;
  let base;

  before(async () => {
    server = await serve();
    base = `http://127.0.0.1:${server.address().port}/`;
    browser = await playwright.chromium.launch();
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  // A fresh page with the default sample loaded. `setup` runs before the
  // page loads, for routes. Page errors fail the test.
  async function open(t, setup) {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));
    page.on('console', (message) => {
      if (message.type() === 'warning' && message.text().startsWith('[colourio]')) errors.push(new Error(message.text()));
    });
    t.after(async () => {
      await context.close();
      assert.deepEqual(errors, [], 'no page errors or ignored state machine events');
    });
    if (setup) await setup(page);
    await page.goto(base);
    await page.waitForSelector('html[data-workspace="sampling"][data-image="idle"]');
    return page;
  }

  test('starts on the first sample, sampling', async (t) => {
    const page = await open(t);
    assert.equal(await page.evaluate(() => window.colourio.currentSample()), 'pier-at-sunset');
    assert.equal(await page.isVisible('#stageInner'), true);
    assert.equal(await page.isVisible('#empty'), false);
    assert.equal(await page.isEnabled('#downloadBtn'), true);
  });

  test('opened from a file, it asks for an image', async (t) => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.goto(new URL('index.html', `file://${ROOT}`).href);
    // Browsers block reading the bundled sample's pixels over file://.
    await page.waitForSelector('#emptySub:has-text("served over http")');
    assert.equal(await page.getAttribute('html', 'data-workspace'), 'empty');
    assert.equal(await page.isVisible('#empty'), true);
    assert.equal(await page.isDisabled('#downloadBtn'), true);
    assert.deepEqual(errors, []);
  });

  test('a click locks the line and another unlocks it', async (t) => {
    const page = await open(t);
    await page.click('#source');
    assert.equal(await page.textContent('#lockLabel'), 'Locked');
    await page.click('#source');
    assert.equal(await page.textContent('#lockLabel'), 'Following');
  });

  test('the newest image wins when an older one loads late', async (t) => {
    const page = await open(t, (p) => p.route('**/samples/great-wave.jpg', async (route) => {
      await delay(800);
      await route.continue();
    }));
    await page.evaluate(() => {
      const samples = window.COLOURIO_SAMPLES;
      window.colourio.loadSample(samples.find((s) => s.id === 'great-wave'));
      window.colourio.loadSample(samples.find((s) => s.id === 'starry-night'));
    });
    await page.waitForSelector('html[data-image="idle"]');
    await delay(1200); // past the slow load
    assert.equal(await page.evaluate(() => window.colourio.currentSample()), 'starry-night');
    assert.equal(await page.getAttribute('html', 'data-image'), 'idle');
  });

  test('crop opens, cancels with Escape and applies with Enter', async (t) => {
    const page = await open(t);
    await page.click('#cropBtn');
    await page.waitForSelector('html[data-workspace="cropping"]');
    assert.equal(await page.textContent('#sourceHeading'), 'Crop');
    await page.keyboard.press('Escape');
    await page.waitForSelector('html[data-workspace="sampling"]');
    assert.equal(await page.textContent('#sourceHeading'), 'Source');

    await page.click('#cropBtn');
    await page.click('[data-ratio="1:1"]');
    await page.focus('#cropStage');
    await page.keyboard.press('Enter');
    await page.waitForSelector('html[data-workspace="sampling"]');
    assert.match(await page.textContent('#toast'), /^Cropped to (\d+) × \1$/);
  });

  test('Escape in a dialog opened over the crop closes only the dialog', async (t) => {
    const page = await open(t);
    await page.click('#cropBtn');
    await page.click('#samplesBtn');
    await page.waitForSelector('#samplesDialog[open]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('samplesDialog').open);
    assert.equal(await page.getAttribute('html', 'data-workspace'), 'cropping');
    assert.equal(await page.isVisible('#cropToolbar'), true);
  });

  test('share dialog prepares the session file, then closes', async (t) => {
    const page = await open(t);
    await page.click('#shareBtn');
    await page.waitForSelector('html[data-share="ready"]');
    assert.equal(await page.isEnabled('#shareFileBtn'), true);
    assert.equal(await page.isEnabled('#shareDetailsBtn'), true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('html[data-share="closed"]');
  });

  test('a share link reopens its sample', async (t) => {
    const page = await open(t);
    await page.evaluate(() => { location.hash = 'v=1&d=column&b=crisp&o=match&s=great-wave&p=10&t=3'; });
    await page.waitForFunction(() => window.colourio.currentSample() === 'great-wave');
    await page.waitForSelector('html[data-image="idle"]');
    assert.equal(await page.isChecked('#dirColumn'), true);
    assert.equal(await page.isChecked('#blendCrisp'), true);
    assert.equal(await page.textContent('#lockLabel'), 'Locked');
  });

  test('wallpapers render and download', async (t) => {
    const page = await open(t);
    await page.click('#wallpapersBtn');
    await page.waitForSelector('html[data-wallpapers="ready"]', { timeout: 30000 });
    assert.equal(await page.textContent('#wallpapersDownloadBtn'), 'Download ZIP');
    const download = page.waitForEvent('download');
    await page.click('#wallpapersDownloadBtn');
    assert.match((await download).suggestedFilename(), /-wallpapers\.zip$/);
    await page.waitForSelector('html[data-wallpapers="closed"]');
  });

  test('wallpapers ask for a screen when none is ticked', async (t) => {
    const page = await open(t);
    await page.click('#wallpapersBtn');
    // The checkboxes are hidden inside their cards, so tick through the cards.
    for (const card of await page.$$('#wallpaperDevices label')) await card.click();
    await page.waitForSelector('html[data-wallpapers="empty"]');
    assert.equal(await page.textContent('#wallpapersStatus'), 'Pick at least one screen.');
    assert.equal(await page.isDisabled('#wallpapersDownloadBtn'), true);
    await page.click('#wallpaperDevices label >> nth=0');
    await page.waitForSelector('html[data-wallpapers="ready"]', { timeout: 30000 });
  });

  test('print dialog in demo mode makes a file and an example link', async (t) => {
    const page = await open(t);
    await page.click('#printBtn');
    await page.waitForSelector('html[data-print="choosing"]');
    assert.equal(await page.isVisible('#printDemo'), true);
    await page.click('#printGoBtn');
    await page.waitForSelector('html[data-print="demoReady"]', { timeout: 30000 });
    assert.equal(await page.isVisible('#printDownload'), true);
    assert.equal(await page.isVisible('#printGoBtn'), false);
    assert.match(await page.textContent('#printLinkText'), /^https:\/\/www\.zazzle\.com\/api\/create\/at-YOUR_MEMBER_ID\?/);
    await page.keyboard.press('Escape');
    await page.waitForSelector('html[data-print="closed"]');
  });

  // Live mode, with print.js configured on the fly and the upload host faked.
  const live = (upload) => async (page) => {
    await page.route('**/print.js', async (route) => {
      const source = await readFile(join(ROOT, 'print.js'), 'utf8');
      await route.fulfill({
        contentType: 'text/javascript',
        body: source
          .replace("memberId: ''", "memberId: '238000000000000000'")
          .replace("url: ''", "url: 'https://prints.test'")
          .replaceAll("productId: ''", "productId: '256000000000000000'"),
      });
    });
    await page.route('https://prints.test/**', upload);
    await page.route('https://rlv.zazzle.com/**', (route) => route.abort());
  };

  test('print upload: a late result for another product is ignored', async (t) => {
    const page = await open(t, live(async (route) => {
      await delay(800);
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{"url":"https://prints.test/v1/prints/a.png"}' });
    }));
    await page.click('#printBtn');
    await page.click('#printGoBtn');
    await page.waitForSelector('html[data-print="uploading"]', { timeout: 30000 });
    await page.click('#printProducts label >> nth=1');
    await page.waitForSelector('html[data-print="choosing"]');
    await delay(1200); // past the upload
    assert.equal(await page.getAttribute('html', 'data-print'), 'choosing');
    assert.equal(await page.isVisible('#printOpen'), false);
    assert.equal(await page.isVisible('#printGoBtn'), true);
    assert.equal(await page.textContent('#printStatus'), '');
  });

  test('print upload: success links to Zazzle', async (t) => {
    const page = await open(t, live((route) => route.fulfill({
      status: 201, contentType: 'application/json', body: '{"url":"https://prints.test/v1/prints/a.png"}',
    })));
    await page.click('#printBtn');
    await page.click('#printGoBtn');
    await page.waitForSelector('html[data-print="ready"]', { timeout: 30000 });
    assert.match(await page.getAttribute('#printOpen', 'href'), /t_image1_iid=https%3A%2F%2Fprints\.test%2Fv1%2Fprints%2Fa\.png/);
    assert.equal(await page.isVisible('#printOpen'), true);
    assert.equal(await page.isVisible('#printGoBtn'), false);
  });

  test('print upload: a failure can be retried', async (t) => {
    let attempts = 0;
    const page = await open(t, live((route) => {
      attempts++;
      return attempts === 1
        ? route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"too many uploads, try again in a minute"}' })
        : route.fulfill({ status: 201, contentType: 'application/json', body: '{"url":"https://prints.test/v1/prints/b.png"}' });
    }));
    await page.click('#printBtn');
    await page.click('#printGoBtn');
    await page.waitForSelector('html[data-print="uploadFailed"]', { timeout: 30000 });
    assert.match(await page.textContent('#printStatus'), /^Upload failed \(too many uploads, try again in a minute\)\./);
    assert.equal(await page.isVisible('#printDownload'), true);
    assert.equal(await page.textContent('#printGoBtn'), 'Try upload again');
    await page.click('#printGoBtn');
    await page.waitForSelector('html[data-print="ready"]');
    assert.equal(attempts, 2);
  });
});
