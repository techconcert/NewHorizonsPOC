// Shared helpers for browser smoke runs of the built game (served from /home/claude/smoke/dist).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = '/home/claude/smoke/dist';
const SHOTS = '/tmp/claude-0/-home-claude/bb24c6f8-e17b-5349-beae-7cb42df07970/scratchpad/shots';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function freePort(start) {
  return new Promise((resolve) => {
    const tryP = (p) => {
      const s = net.createServer();
      s.once('error', () => tryP(p + 1));
      s.once('listening', () => s.close(() => resolve(p)));
      s.listen(p, '127.0.0.1');
    };
    tryP(start);
  });
}

async function boot(query = '?debug&seed=42', viewport = { width: 1280, height: 800 }) {
  const port = await freePort(5273);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(port, '127.0.0.1');
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/${query}`);
  await page.waitForTimeout(1500);
  const close = async () => { await browser.close(); server.close(); };
  return { page, errors, close, port };
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const text = (page) => page.evaluate(() => document.body.innerText);
const buttons = (page) => page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && !b.disabled).map((b) => b.textContent.trim()));

// Screen positions of star dots: read pixels from the WebGL canvas is unreliable, so ask the page via its snapshot-driven DOM is not
// possible; instead scan the screenshot for saturated pixels.
module.exports = { boot, shot, text, buttons, SHOTS };
