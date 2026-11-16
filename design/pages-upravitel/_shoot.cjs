/* Снимки на модула „Управител“ (по образец на ../pages-admin/_shoot.cjs). Пуска свой статичен http сървър от design/ на свободен
   порт и Chromium от require('playwright'). Спира само своя сървър.
   Usage (от design/): node pages-upravitel/_shoot.cjs "pages-upravitel/now.html#st=rush" [outDir]
        [--session=manager|owner|admin|waiter|none] [--click="sel|sel"] [--eval="js"] [--wait=1500] [--h=2400] [--full]
        [--only=390-light,1440-dark] [--tag=x] [--keep]
   Прави 1440, 1024, 390 и 360, светла и тъмна (8 снимки). Проверява хоризонтален скрол, текст под 14px, цели под 44 px,
   дали кръглият „Молив“ застъпва нещо, което се натиска (най-долу на страницата), и показва грешките в конзолата. */
const { chromium } = require('playwright');
const http = require('http'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2); const page = args[0]; const out = (args[1] && !args[1].startsWith('--')) ? args[1] : path.resolve(ROOT, '..', 'shots', 'up');
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.resolve(ROOT, '.' + p); if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf); });
});
const file = page.split('#')[0], hash = page.includes('#') ? page.split('#')[1] : '';
const name = path.basename(file, '.html') + (hash ? '_' + hash.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) : '') + (opt.session && opt.session !== 'manager' ? '_' + opt.session : '') + (opt.tag ? '_' + opt.tag : '');
let runs = [['1440-light', 1440, 900, 'light'], ['1440-dark', 1440, 900, 'dark'], ['1024-light', 1024, 768, 'light'], ['1024-dark', 1024, 768, 'dark'], ['390-light', 390, 844, 'light'], ['390-dark', 390, 844, 'dark'], ['360-light', 360, 740, 'light'], ['360-dark', 360, 740, 'dark']];
if (opt.only) runs = runs.filter(r => opt.only.split(',').includes(r[0]));
const ACC = { admin: 'Поли', owner: 'Собственик 1', manager: 'Управител 1', waiter: 'Сервитьор 1', marketing: 'Маркетинг 1' };
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port; const base = `http://127.0.0.1:${port}/`;
  const b = await chromium.launch(); const errors = []; const notes = [];
  try {
    for (const [tag, w, h0, theme] of runs) {
      const h = +(opt.h || h0); const phone = w < 700;
      const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: phone, isMobile: phone, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      p.on('pageerror', e => errors.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
      const sess = opt.session || 'manager';
      await p.addInitScript(([theme, sess, nm, keep]) => { try {
        if (window.top !== window) return; if (sessionStorage.getItem('mg-shot')) return; sessionStorage.setItem('mg-shot', '1');
        if (!keep) localStorage.clear();
        localStorage.setItem('sa-prefs', JSON.stringify({ theme: theme, side: 'open' }));
        if (sess !== 'none') localStorage.setItem('sa-session', JSON.stringify({ user: sess, name: nm, role: sess })); else localStorage.removeItem('sa-session');
      } catch (e) {} }, [theme, sess, ACC[sess] || 'Управител 1', !!opt.keep]);
      await p.goto(base + file + (hash ? '#' + hash : '')); await p.waitForTimeout(+(opt.wait || 1300));
      if (opt.eval) { await p.evaluate(opt.eval).catch(e => errors.push(tag + ' eval: ' + e.message)); await p.waitForTimeout(600); }
      if (opt.click) { for (const sel of opt.click.split('|')) { await p.click(sel, { timeout: 4000 }).catch(() => errors.push(tag + ' click failed: ' + sel)); await p.waitForTimeout(700); } }
      const chk = await p.evaluate(() => { const r = { hs: [], small: [], tiny: [] }; const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth + 1) r.hs.push('document ' + de.scrollWidth + '>' + de.clientWidth);
        document.querySelectorAll('.mg-find .fbody, .mg-sheet .body, .mg-dpanel').forEach(s => { if (s.scrollWidth > s.clientWidth + 1) r.hs.push(s.className + ' ' + s.scrollWidth + '>' + s.clientWidth); });
        const seen = new Set();
        document.querySelectorAll('body *').forEach(el => { if (!el.childNodes.length) return; const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()); if (!own) return;
          const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize); const rc = el.getBoundingClientRect(); if (!rc.width || cs.visibility === 'hidden' || cs.display === 'none') return;
          if (fs < 14 && !seen.has(el.tagName + el.className)) { seen.add(el.tagName + el.className); r.small.push(fs + 'px ' + el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 30) + ' "' + el.textContent.trim().slice(0, 30) + '"'); } });
        document.querySelectorAll('a[href], button, input, select, [role=switch]').forEach(el => { const rc = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (!rc.width || cs.visibility === 'hidden' || el.closest('[hidden], .vh, sa-pen-ui, .mg-proto')) return;
          if (el.tagName === 'INPUT' && (el.type === 'checkbox')) { const s = el.parentElement.getBoundingClientRect(); if (s.height < 44 || s.width < 44) r.tiny.push('switch ' + Math.round(s.width) + 'x' + Math.round(s.height)); return; }
          if (rc.height < 44 || rc.width < 44) r.tiny.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 24) + ' ' + Math.round(rc.width) + 'x' + Math.round(rc.height) + ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24) + '"'); });
        return r; });
      if (chk.hs.length) notes.push(tag + ' ХОРИЗОНТАЛЕН СКРОЛ: ' + chk.hs.join(', '));
      if (chk.small.length) notes.push(tag + ' текст под 14px: ' + chk.small.slice(0, 6).join(' | '));
      if (chk.tiny.length) notes.push(tag + ' цели под 44px: ' + chk.tiny.slice(0, 6).join(' | '));
      await p.screenshot({ path: `${out}/${name}-${tag}.png`, fullPage: !!opt.full });
      /* моливът най-долу на страницата: не стои върху нищо, което се натиска */
      const pen = await p.evaluate(async () => { const btn = document.querySelector('.sa-pen-btn'); if (!btn) return 'няма молив';
        window.scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => setTimeout(r, 250));
        const b = btn.getBoundingClientRect(); if (!b.width || getComputedStyle(btn).opacity === '0') return 'моливът е скрит';
        const hit = []; document.querySelectorAll('a[href], button, input, [role=switch]').forEach(el => { if (el === btn || btn.contains(el) || el.closest('[hidden], sa-pen-ui')) return; const r = el.getBoundingClientRect(); if (!r.width) return;
          if (r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) hit.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24)); });
        return hit.length ? 'МОЛИВЪТ ЗАСТЪПВА: ' + hit.join(' | ') : 'ok'; });
      if (pen !== 'ok' && pen !== 'няма молив') notes.push(tag + ' ' + pen);
      if (opt.end) await p.screenshot({ path: `${out}/${name}-${tag}-end.png` });
      await ctx.close();
    }
  } finally { await b.close(); server.close(); }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(notes.length ? 'CHECKS:\n' + notes.join('\n') : 'checks ok (no horizontal scroll, no text < 14px, targets >= 44px, pencil clear)');
  console.log('screenshots in', out, 'as', name + '-*.png');
});
