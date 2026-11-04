/* Screenshots for the driver app (copy of pages-servitor/_shoot.cjs) (modelled on tools/shoot.js; the staff pages use their own chrome, no SC.mount).
   Usage (from design/): node pages-shofyor/_shoot.cjs pages-shofyor/list.html outDir [--state=rush] [--time=21:30] [--click="sel|sel"] [--scroll=600] [--only=390-light,390-dark]
   Shots: 390-light, 390-dark, 360-light, 360-dark (viewport) and 390-full (whole page, light). Prints console errors. */
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const args = process.argv.slice(2); const page = args[0]; const out = (args[1] && !args[1].startsWith('--')) ? args[1] : 'shots';
const opt = Object.fromEntries(args.filter(a=>a.startsWith('--')).map(a=>{ const i=a.indexOf('='); return [a.slice(2,i), a.slice(i+1)]; }));
fs.mkdirSync(out, {recursive:true});
const file = page.split('#')[0]; const hash = page.includes('#') ? '#'+page.split('#')[1] : '';
const url = 'file://' + path.resolve(__dirname, '..', file) + hash;
const name = path.basename(file, '.html') + (opt.tag ? '-'+opt.tag : '');
const runs = [['390-light',390,844,'light',false],['390-dark',390,844,'dark',false],['360-light',360,740,'light',false],['360-dark',360,740,'dark',false],['390-full',390,844,'light',true]]
  .filter(r => !opt.only || opt.only.split(',').includes(r[0]));
(async () => {
  const b = await chromium.launch(); const errors = [];
  for (const [tag, w, h, theme, full] of runs) {
    const ctx = await b.newContext({viewport:{width:w, height:h}, deviceScaleFactor:1}); const p = await ctx.newPage();
    p.on('pageerror', e=>errors.push(tag+': '+e.message)); p.on('console', m=>{ if (m.type()==='error') errors.push(tag+': '+m.text()); });
    await p.addInitScript(([theme,state,time]) => { localStorage.setItem('dr-prefs', JSON.stringify({theme, state:state||'normal'})); localStorage.setItem('sc-prefs', JSON.stringify({theme, view:'phone', time:time||'now'})); }, [theme, opt.state, opt.time]);
    await p.goto(url); await p.waitForTimeout(700);
    if (opt.click) { for (const sel of opt.click.split('|')) { await p.click(sel, {timeout:3000}).catch(()=>errors.push('click failed: '+sel)); await p.waitForTimeout(500); } }
    if (opt.type) { const [sel, txt] = opt.type.split('='); await p.fill(sel, txt).catch(()=>errors.push('type failed: '+sel)); await p.waitForTimeout(400); }
    if (opt.scroll) { await p.evaluate(y=>window.scrollTo(0,+y), opt.scroll); await p.waitForTimeout(500); }
    const over = await p.evaluate(()=>document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) errors.push(tag+': horizontal overflow '+over+'px');
    const small = await p.evaluate(()=>{ const bad=[]; document.querySelectorAll('body *').forEach(el=>{ if (!el.childNodes.length) return; const hasText=[...el.childNodes].some(n=>n.nodeType===3 && n.textContent.trim()); if (!hasText) return; const r=el.getBoundingClientRect(); if (!r.width) return; const fs=parseFloat(getComputedStyle(el).fontSize); if (fs<14) bad.push(el.tagName+'.'+el.className+' '+fs+'px "'+el.textContent.trim().slice(0,20)+'"'); }); return bad.slice(0,5); });
    if (small.length) errors.push(tag+': text under 14px: '+small.join('; '));
    await p.screenshot({path:`${out}/${name}-${tag}.png`, fullPage:full});
    await ctx.close();
  }
  await b.close(); console.log(errors.length ? 'ERRORS:\n'+errors.join('\n') : 'no console errors'); console.log('screenshots in', out);
})();
