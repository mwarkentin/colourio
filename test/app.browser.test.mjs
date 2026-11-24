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
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

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
    // Nothing leaves the machine: prints are live, so an unfaked upload would
    // reach the real prints Worker. Tests fake the hosts they need with
    // page.route, which takes precedence over this.
    await context.route((url) => !url.href.startsWith(base), (route) => route.abort());
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

  // print.js served with its settings changed, so the tests don't depend on
  // which products are live. Each change must find what it replaces.
  const configure = (changes) => (page) => page.route('**/print.js', async (route) => {
    let source = await readFile(join(ROOT, 'print.js'), 'utf8');
    for (const [pattern, replacement] of changes) {
      const changed = source.replace(pattern, replacement);
      assert.notEqual(changed, source, `print.js no longer has ${pattern}`);
      source = changed;
    }
    await route.fulfill({ contentType: 'text/javascript', body: source });
  });

  // The dialog's choices, by material id or product id.
  const material = (id) => `#printMaterials label:has(input[value="${id}"])`;
  const shape = (id) => `#printShapes label:has(input[value="${id}"])`;
  const shapes = (page) => page.$$eval('#printShapes input', (inputs) => inputs.map((i) => i.value));
  const checked = (page, group) => page.$eval(`${group} input:checked`, (i) => i.value);

  test('print dialog groups products by material, then shape', async (t) => {
    const page = await open(t);
    await page.click('#printBtn');
    await page.waitForSelector('html[data-print="choosing"]');
    assert.deepEqual(await page.$$eval('#printMaterials .print-name', (els) => els.map((e) => e.textContent)), ['Poster', 'Canvas']);
    assert.deepEqual(await page.$$eval('#printMaterials .print-size', (els) => els.map((e) => e.textContent)), ['3 shapes', 'Portrait · 4:5']);
    assert.deepEqual(await shapes(page), ['poster-portrait', 'poster-landscape', 'square']);
    assert.deepEqual(await page.$$eval('#printShapes label', (els) => els.map((e) => e.textContent)),
      ['Portrait3:4', 'Landscape4:3', 'Square1:1']);
    assert.equal(await checked(page, '#printShapes'), 'poster-portrait');

    // Each option's thumbnail has its shape.
    const thumbs = await page.$$eval('#printShapes .print-thumb', (els) => els.map((e) => [e.offsetWidth, e.offsetHeight]));
    assert.deepEqual(thumbs, [[24, 32], [32, 24], [32, 32]]);

    // Switching material shows its shapes, and switching back keeps the shape picked before.
    await page.click(shape('square'));
    await page.click(material('canvas'));
    assert.deepEqual(await shapes(page), ['canvas']);
    assert.equal(await checked(page, '#printShapes'), 'canvas');
    await page.click(material('poster'));
    assert.equal(await checked(page, '#printShapes'), 'square');
    // The material card's thumbnail follows its shape.
    const thumb = await page.$eval('#printMaterials label:has(input[value="poster"]) .print-thumb', (e) => [e.offsetWidth, e.offsetHeight]);
    assert.deepEqual(thumb, [80, 80]);

    // Arrow keys move through each group.
    await page.focus('#printShapes input:checked');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await checked(page, '#printShapes'), 'poster-landscape');
    await page.focus('#printMaterials input:checked');
    await page.keyboard.press('ArrowRight');
    assert.equal(await checked(page, '#printMaterials'), 'canvas');
    assert.deepEqual(await shapes(page), ['canvas']);
    await page.waitForSelector('html[data-print="choosing"]');
  });

  // Products are grouped by their `material`, so a new one is a single entry.
  test('print dialog shows a new material from one product entry', async (t) => {
    const page = await open(t, configure([[
      /products: \[/,
      "products: [{ id: 'metal-square', material: 'Metal', width: 12, height: 12, productId: '' },",
    ]]));
    await page.click('#printBtn');
    assert.equal(await checked(page, '#printMaterials'), 'metal');
    assert.equal(await page.isVisible('#printDemo'), true);
    await page.click(material('canvas'));
    assert.equal(await page.isVisible('#printDemo'), false);
    await page.click(material('metal'));
    await page.click('#printGoBtn');
    await page.waitForSelector('html[data-print="demoReady"]', { timeout: 30000 });
    assert.match(await page.getAttribute('#printDownload', 'download'), /-metal-square\.png$/);
  });

  // Demo mode: no product has a Zazzle template, so nothing is uploaded.
  test('print dialog in demo mode makes a file and an example link', async (t) => {
    const page = await open(t, configure([[/productId: '\d+'/g, "productId: ''"]]));
    await page.click('#printBtn');
    await page.waitForSelector('html[data-print="choosing"]');
    assert.equal(await page.isVisible('#printDemo'), true);
    await page.click('#printGoBtn');
    await page.waitForSelector('html[data-print="demoReady"]', { timeout: 30000 });
    assert.equal(await page.isVisible('#printDownload'), true);
    assert.equal(await page.isVisible('#printGoBtn'), false);
    assert.match(await page.textContent('#printLinkText'), /^https:\/\/www\.zazzle\.com\/api\/create\/at-[^?]+\?.*pd=YOUR_PRODUCT_ID/);
    // Every file fills the pixel cap, so it stays sharp at bigger sizes on Zazzle.
    assert.match(await page.textContent('#printStatus'), /^Print file ready · 3464 × 4619 px \(192 ppi at 18 × 24 in\) · /);
    await page.keyboard.press('Escape');
    await page.waitForSelector('html[data-print="closed"]');
  });

  // The canvas wraps round its frame, so its file has mirrored margins.
  test('print file for the canvas has mirrored edges', async (t) => {
    const page = await open(t, configure([[/productId: '\d+'/g, "productId: ''"]]));
    await page.click('#printBtn');
    await page.click(material('canvas'));
    await page.click('#printGoBtn');
    await page.waitForSelector('html[data-print="demoReady"]', { timeout: 30000 });
    const result = await page.evaluate(async () => {
      const blob = await (await fetch(document.getElementById('printDownload').href)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const wrap = 327; // 1.75 in
      const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
      const y = Math.round(bitmap.height / 2);
      const mirrored = [1, 10, 100, wrap - 1].every((d) =>
        px(wrap - 1 - d + 1, y).join() === px(wrap + d - 1, y).join() &&
        px(bitmap.width - wrap + d - 1, y).join() === px(bitmap.width - wrap - d, y).join());
      return { width: bitmap.width, height: bitmap.height, mirrored };
    });
    // 16 × 20 in plus 1.75 in on each side, at the 16 megapixel cap (186 ppi).
    assert.deepEqual(result, { width: 3644, height: 4391, mirrored: true });
  });

  // Live mode: every product has a template, and the upload host is faked
  // (whatever print.js points at, uploads go to prints.test).
  const live = (upload) => async (page) => {
    await configure([
      [/memberId: '[^']*'/, "memberId: '238000000000000000'"],
      [/printsUrl: '[^']*'/, "printsUrl: 'https://prints.test'"],
      [/productId: '[^']*'/g, "productId: '256000000000000000'"],
    ])(page);
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
    await page.click(shape('poster-landscape'));
    await page.waitForSelector('html[data-print="choosing"]');
    await delay(1200); // past the upload
    assert.equal(await page.getAttribute('html', 'data-print'), 'choosing');
    assert.equal(await page.isVisible('#printOpen'), false);
    assert.equal(await page.isVisible('#printGoBtn'), true);
    assert.equal(await page.textContent('#printStatus'), '');
  });

  test('print upload: switching material drops the upload under way', async (t) => {
    const page = await open(t, live(async (route) => {
      await delay(800);
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{"url":"https://prints.test/v1/prints/a.png"}' });
    }));
    await page.click('#printBtn');
    await page.click('#printGoBtn');
    await page.waitForSelector('html[data-print="uploading"]', { timeout: 30000 });
    await page.click(material('canvas'));
    await page.waitForSelector('html[data-print="choosing"]');
    await delay(1200); // past the upload
    assert.equal(await page.getAttribute('html', 'data-print'), 'choosing');
    assert.equal(await page.isVisible('#printOpen'), false);
  });

  test('print upload: success links to Zazzle', async (t) => {
    const page = await open(t, live((route) => route.fulfill({
      status: 201, contentType: 'application/json', body: '{"url":"https://prints.test/v1/prints/a.png"}',
    })));
    await page.click('#printBtn');
    await page.click('#printGoBtn');
    await page.waitForSelector('html[data-print="ready"]', { timeout: 30000 });
    const href = await page.getAttribute('#printOpen', 'href');
    assert.match(href, /t_image1_iid=https%3A%2F%2Fprints\.test%2Fv1%2Fprints%2Fa\.png/);
    // Self-Promotion links: a tracking code is fine, an Ambassador ID isn't.
    assert.equal(new URL(href).searchParams.get('tc'), 'colourio');
    assert.equal(new URL(href).searchParams.has('rf'), false);
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

  test('the manifest loads, with the icons Add to Home Screen needs', async (t) => {
    const page = await open(t);
    const href = await page.evaluate(() => document.querySelector('link[rel="manifest"]').href);
    const response = await page.request.get(href);
    assert.equal(response.ok(), true);
    const manifest = JSON.parse(await response.text());
    assert.equal(manifest.name, 'colourio');
    assert.equal(manifest.short_name, 'colourio');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/);
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/);
    const icons = (purpose, sizes) => manifest.icons.filter((i) => i.purpose === purpose && i.sizes === sizes);
    assert.equal(icons('any', '192x192').length, 1);
    assert.equal(icons('any', '512x512').length, 1);
    assert.equal(icons('maskable', '512x512').length, 1);

    // Every icon, and the apple-touch-icon, loads at the size it claims.
    const appleIcon = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]').href);
    const images = [
      ...manifest.icons.map((icon) => ({ src: new URL(icon.src, href).href, sizes: icon.sizes })),
      { src: appleIcon, sizes: '180x180' },
    ];
    for (const { src, sizes } of images) {
      const size = await page.evaluate((url) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
        img.onerror = () => reject(new Error(`${url} didn't load`));
        img.src = url;
      }), src);
      if (sizes !== 'any') assert.equal(size, sizes, src);
    }
  });

  test('a share link opens straight to its sample', async (t) => {
    // As when a share link opens the installed app, rather than the hash
    // changing on a page that's already open.
    const context = await browser.newContext();
    t.after(() => context.close());
    await context.route((url) => !url.href.startsWith(base), (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.goto(`${base}#v=1&d=column&b=crisp&o=match&s=great-wave&p=10&t=3`);
    await page.waitForFunction(() => window.colourio?.currentSample() === 'great-wave');
    await page.waitForSelector('html[data-image="idle"]');
    assert.equal(await page.isChecked('#dirColumn'), true);
    assert.equal(await page.textContent('#lockLabel'), 'Locked');
    assert.deepEqual(errors, []);
  });
});
