/* Copy of tools/shoot.js as CommonJS (the repo package.json is "type":"module"). Usage: node pages-masa/_shoot.cjs pages/home.html [outDir] [--time=12:30] [--click=selector] [--scroll=px]
   Makes 4 screenshots: phone light, phone dark, desktop 1440 light, full-page phone (tall). Prints console errors. */
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const args = process.argv.slice(2); const page = args[0]; const out = (args[1] && !args[1].startsWith('--')) ? args[1] : 'shots';
const opt = Object.fromEntries(args.filter(a=>a.startsWith('--')).map(a=>{ const i=a.indexOf('='); return [a.slice(2,i), a.slice(i+1)]; }));
fs.mkdirSync(out, {recursive:true});
const url = 'file://' + path.resolve(__dirname, '..', page.split('#')[0]) + (page.includes('#') ? '#'+page.split('#')[1] : '');
const name = path.basename(page).replace(/[#.=&]/g,'_');
(async () => {
  const b = await chromium.launch(); const errors = [];
  const runs = [['phone-light',{width:1280,height:950},{view:'phone',theme:'light'}],['phone-dark',{width:1280,height:950},{view:'phone',theme:'dark'}],['desktop',{width:1440,height:900},{view:'desktop',theme:'light'}]];
  for (const [tag, vp, pr] of runs) {
    const ctx = await b.newContext({viewport:vp}); const p = await ctx.newPage();
    p.on('pageerror', e=>errors.push(tag+': '+e.message)); p.on('console', m=>{ if (m.type()==='error') errors.push(tag+': '+m.text()); });
    await p.addInitScript(([pr,time]) => { localStorage.setItem('sc-prefs', JSON.stringify({theme:pr.theme, view:pr.view, time:time||'12:30'})); localStorage.setItem('sc-cookie','"min"'); }, [pr, opt.time]);
    await p.goto(url); await p.waitForTimeout(1200);
    if (opt.click) { for (const sel of opt.click.split('|')) { await p.click(sel).catch(e=>errors.push('click failed: '+sel)); await p.waitForTimeout(500); } }
    if (opt.scroll) { await p.evaluate(y=>{ document.querySelector('[data-scroller]').scrollTop=+y; }, opt.scroll); await p.waitForTimeout(800); }
    await p.screenshot({path:`${out}/${name}-${tag}.png`});
    if (tag==='phone-light') { // tall render of the whole page content at phone width
      const c2 = await b.newContext({viewport:{width:390,height:844}}); const q = await c2.newPage();
      await q.addInitScript(([time]) => { localStorage.setItem('sc-prefs', JSON.stringify({theme:'light', view:'phone', time:time||'12:30'})); localStorage.setItem('sc-cookie','"min"'); }, [opt.time]);
      await q.goto(url); await q.waitForTimeout(1200);
      const h = await q.evaluate(()=>{ const s=document.querySelector('[data-scroller]'); document.querySelector('.device').style.height=s.scrollHeight+'px'; return s.scrollHeight; });
      await q.setViewportSize({width:390, height:Math.min(h, 12000)}); await q.waitForTimeout(400);
      await q.screenshot({path:`${out}/${name}-full.png`, fullPage:true}); await c2.close();
    }
    await ctx.close();
  }
  await b.close(); console.log(errors.length ? 'ERRORS:\n'+errors.join('\n') : 'no console errors'); console.log('screenshots in', out);
})();
