/* Снимки на екраните на админа. Пуска малък статичен http сървър от design/ на свободен порт (не file://, за да работят
   рамките на прегледа и моливът на един произход) и Chromium от require('playwright') (без install). Спира само своя сървър.
   Usage (от design/): node pages-admin/_shoot.cjs "pages-admin/dashboard.html#st=empty" outDir
        [--session=admin|owner|manager|waiter|kitchen|driver|marketing|none] [--click="sel|sel"] [--wait=1400] [--h=2400]
        [--only=1440-light,390-dark] [--keep] [--eval="js"]
   Прави 1440 светла и тъмна, 1024 светла, 390 светла и тъмна, 360 светла. Проверява хоризонтален скрол и текст под 14px
   (на всяка ширина) и показва грешките в конзолата. */
const { chromium } = require('playwright');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2); const page = args[0]; const out = (args[1] && !args[1].startsWith('--')) ? args[1] : path.resolve(ROOT, '..', 'shots', 'admin-1');
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf); });
});
const file = page.split('#')[0], hash = page.includes('#') ? page.split('#')[1] : '';
const name = path.basename(file, '.html') + (hash ? '_' + hash.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) : '') + (opt.session && opt.session !== 'admin' ? '_' + opt.session : '') + (opt.tag ? '_' + opt.tag : '');
let runs = [['1440-light', 1440, 900, 'light'], ['1440-dark', 1440, 900, 'dark'], ['1024-light', 1024, 768, 'light'], ['390-light', 390, 844, 'light'], ['390-dark', 390, 844, 'dark'], ['360-light', 360, 740, 'light']];
if (opt.only) runs = runs.filter(r => opt.only.split(',').includes(r[0]));
const ACC = { admin: 'Поли', owner: 'Собственик 1', manager: 'Управител 1', waiter: 'Сервитьор 1', kitchen: 'Кухня · Скара', driver: 'Шофьор 1', marketing: 'Маркетинг 1' };
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port; const base = `http://127.0.0.1:${port}/`;
  const b = await chromium.launch(); const errors = []; const notes = [];
  try {
    for (const [tag, w, h0, theme] of runs) {
      const h = +(opt.h || h0); const phone = w < 700;
      const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: phone, isMobile: phone, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      p.on('pageerror', e => errors.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
      const sess = opt.session || 'admin';
      await p.addInitScript(([theme, sess, name, keep]) => { try {
        if (window.top !== window) return; if (sessionStorage.getItem('sa-shot')) return; sessionStorage.setItem('sa-shot', '1');
        if (!keep) localStorage.clear();
        localStorage.setItem('sa-prefs', JSON.stringify({ theme: theme, side: 'open' }));
        if (sess !== 'none') localStorage.setItem('sa-session', JSON.stringify({ user: sess, name: name, role: sess })); else localStorage.removeItem('sa-session');
      } catch (e) {} }, [theme, sess, ACC[sess] || 'Поли', !!opt.keep]);
      await p.goto(base + file + (hash ? '#' + hash : '')); await p.waitForTimeout(+(opt.wait || 1300));
      if (opt.eval) { await p.evaluate(opt.eval).catch(e => errors.push(tag + ' eval: ' + e.message)); await p.waitForTimeout(500); }
      if (opt.click) { for (const sel of opt.click.split('|')) { await p.click(sel, { timeout: 4000 }).catch(() => errors.push(tag + ' click failed: ' + sel)); await p.waitForTimeout(650); } }
      const chk = await p.evaluate(() => { const r = { hs: [], small: [] }; const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth + 1) r.hs.push('document ' + de.scrollWidth + '>' + de.clientWidth);
        document.querySelectorAll('[data-scroller], .sa-scroller').forEach(s => { if (s.scrollWidth > s.clientWidth + 1) r.hs.push('scroller ' + s.scrollWidth + '>' + s.clientWidth); });
        const seen = new Set();
        document.querySelectorAll('body *').forEach(el => { if (!el.childNodes.length) return; const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()); if (!own) return;
          const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize); const rc = el.getBoundingClientRect(); if (!rc.width || cs.visibility === 'hidden' || cs.display === 'none') return;
          if (fs < 14 && !seen.has(el.tagName + el.className)) { seen.add(el.tagName + el.className); r.small.push(fs + 'px ' + el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 30) + ' "' + el.textContent.trim().slice(0, 30) + '"'); } });
        return r; });
      if (chk.hs.length) notes.push(tag + ' ХОРИЗОНТАЛЕН СКРОЛ: ' + chk.hs.join(', '));
      if (chk.small.length) notes.push(tag + ' текст под 14px: ' + chk.small.slice(0, 6).join(' | '));
      await p.screenshot({ path: `${out}/${name}-${tag}.png` });
      await ctx.close();
    }
  } finally { await b.close(); server.close(); }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(notes.length ? 'CHECKS:\n' + notes.join('\n') : 'checks ok (no horizontal scroll, no text < 14px)');
  console.log('screenshots in', out, 'as', name + '-*.png');
});
