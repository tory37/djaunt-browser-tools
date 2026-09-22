// Captures a Chrome Web Store screenshot (1280x800) of each extension's popup, by
// actually loading the unpacked extension into Chromium and opening its popup.html
// as a normal page. Chrome only loads extensions in a headed context (or Chromium's
// "new" headless with --headless=new), so this needs a display — run it under
// `xvfb-run` if there's no real one:
//
//   xvfb-run -a node scripts/capture-store-screenshots.mjs
//
// Output goes to <ext>/store-assets/popup.png — gitignored, regenerate on demand.
// This only captures the popup UI. Extensions with a bigger surface (host-swap and
// query-params expanded rows, dark-mode/tab-volume applied to a real page, net-mock's
// rule list) are worth a second, hand-taken screenshot showing that in action before
// submitting — the store allows up to 5 per listing and rewards more than one.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const extensions = [
  'host-swap',
  'query-params',
  'header-editor',
  'prettifier',
  'tab-volume',
  'dark-mode',
  'color-picker',
  'net-mock',
];

async function captureOne(ext) {
  const extPath = path.join(root, ext);
  const userDataDir = path.join(root, '.tmp-profile', ext);
  await mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    // Normally Playwright resolves its own downloaded browser. Set this only if
    // your local Playwright install's expected browser build doesn't match what's
    // actually on disk (e.g. a pre-provisioned/shared browser cache).
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
    ],
  });

  try {
    // Extensions register a service worker once loaded; its URL tells us the
    // extension's runtime id (unpacked extensions get one derived from the path,
    // but it's not predictable ahead of time, so read it back instead of guessing).
    let [worker] = context.serviceWorkers();
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }
    const extensionId = new URL(worker.url()).host;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForTimeout(300); // let the popup's own init render finish

    // Popups are intrinsically sized (a few hundred px), not 1280x800, so left as-is
    // they'd render pinned to the top-left corner of a mostly-empty frame. Center the
    // <body> within <html> via flex, without touching the extension's own markup or
    // CSS, and carry over its own background color so the added margin matches it
    // instead of defaulting to white.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.addStyleTag({
      content: `
        html { display: flex; align-items: center; justify-content: center;
               height: 100%; background: ${bg}; }
      `,
    });

    const outDir = path.join(root, ext, 'store-assets');
    await mkdir(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'popup.png') });
    console.log(`captured ${ext}/store-assets/popup.png`);
  } finally {
    await context.close();
  }
}

for (const ext of extensions) {
  await captureOne(ext);
}
