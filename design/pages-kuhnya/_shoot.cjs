/* Снимки на екраните на кухнята (по образеца на ../tools/shoot.js).
   Usage (от design/): node pages-kuhnya/_shoot.cjs pages-kuhnya/queue.html[#s=skara&st=many] outDir [--click=sel|sel] [--hold=sel] [--holdms=600] [--only=1280-dark,...]
   Прави 1280x800 тъмна и светла, 1024x768 тъмна, 768x1024 тъмна. Показва грешките в конзолата. */
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const args = process.argv.slice(2); const page = args[0]; const out = (args[1] && !args[1].startsWith('--')) ? args[1] : 'shots';
const opt = Object.fromEntries(args.filter(a=>a.startsWith('--')).map(a=>{ const i=a.indexOf('='); return [a.slice(2,i), a.slice(i+1)]; }));
fs.mkdirSync(out, {recursive:true});
const file = page.split('#')[0], hash = page.includes('#') ? page.split('#')[1] : '';
const url = 'file://' + path.resolve(__dirname, '..', file) + (hash ? '#'+hash : '');
const name = path.basename(file, '.html') + (hash ? '_' + hash.replace(/[^a-z0-9]+/gi,'-') : '');
let runs = [['1280-dark',{width:1280,height:800},'dark'],['1280-light',{width:1280,height:800},'light'],['1024-dark',{width:1024,height:768},'dark'],['768-dark',{width:768,height:1024},'dark']];
if (opt.only) runs = runs.filter(r=>opt.only.split(',').includes(r[0]));
(async () => {
  const b = await chromium.launch(); const errors = [];
  for (const [tag, vp, theme] of runs) {
    const ctx = await b.newContext({viewport:vp, hasTouch:true}); const p = await ctx.newPage();
    p.on('pageerror', e=>errors.push(tag+': '+e.message)); p.on('console', m=>{ if (m.type()==='error') errors.push(tag+': '+m.text()); });
    await p.addInitScript(([theme]) => { try{ localStorage.clear(); localStorage.setItem('sk-theme', JSON.stringify(theme)); }catch(e){} }, [theme]);
    await p.goto(url); await p.waitForTimeout(1300);
    if (opt.click) { for (const sel of opt.click.split('|')) { await p.click(sel).catch(()=>errors.push('click failed: '+sel)); await p.waitForTimeout(600); } }
    if (opt.hold) { await p.hover(opt.hold).catch(()=>errors.push('hold failed: '+opt.hold)); await p.mouse.down(); await p.waitForTimeout(+(opt.holdms||1150)); await p.screenshot({path:`${out}/${name}-${tag}-holding.png`}).catch(()=>{}); await p.mouse.up(); await p.waitForTimeout(700); }
    await p.screenshot({path:`${out}/${name}-${tag}.png`});
    await ctx.close();
  }
  await b.close(); console.log(errors.length ? 'ERRORS:\n'+errors.join('\n') : 'no console errors'); console.log('screenshots in', out);
})();
