const {chromium}=require('playwright');
const base='file:///home/user/siracusa-sofia/design/pages-masa/';
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844}});
await ctx.addInitScript(()=>{ if(!localStorage.getItem('sc-cookie')){localStorage.setItem('sc-cookie','"min"');localStorage.setItem('sc-prefs',JSON.stringify({theme:'light',view:'phone',time:'19:30'}));} });
const errs=[];const A=await ctx.newPage(), B=await ctx.newPage();[A,B].forEach((p,i)=>{p.on('pageerror',e=>errs.push(i+': '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push(i+': '+m.text())});});
const log=(...a)=>console.log(...a);
await A.goto(base+'welcome.html');await A.waitForTimeout(600);
await B.goto(base+'cart.html');await B.waitForTimeout(800);
log('A proto:', (await A.textContent('.ptxt')).match(/страница: Телефон \d/)[0], ' B proto:', (await B.textContent('.ptxt')).match(/страница: Телефон \d/)[0]);
log('B groups:', await B.$$eval('.grp-h b', e=>e.map(x=>x.textContent)));
// language per phone
await A.click('.wl-lang [data-mlang="en"]');await A.waitForTimeout(1500);await B.reload();await B.waitForTimeout(800);
log('A lang', await A.getAttribute('html','lang'), 'B lang', await B.getAttribute('html','lang'));
// A adds from menu, B sees
await A.goto(base+'menu.html');await A.waitForTimeout(600);await A.click('[data-madd="pitsa-s-burata-i-proshuto-krudo"]');await B.waitForTimeout(600);
log('B groups after A add:', await B.$$eval('.grp-h b', e=>e.map(x=>x.textContent)));
await A.click('[data-mlang="bg"]');await A.waitForTimeout(600);
// send from B, waiting, then confirm
await B.click('.abar [data-send]');await B.waitForTimeout(500);log('B wait card:', !!(await B.$('.wait')));
await B.click('[data-pconf]');await B.waitForTimeout(500);log('rounds header:', await B.$$eval('.rnd-h', e=>e.map(x=>x.textContent)));
// calls: A calls order, age it 4 min, tile stays active
await A.goto(base+'call.html');await A.waitForTimeout(500);await A.click('[data-call="order"]');await A.waitForTimeout(400);
await A.evaluate(()=>{const s=JSON.parse(localStorage.getItem('sc-masa'));s.calls.order.at-=240000;localStorage.setItem('sc-masa',JSON.stringify(s));});
await A.reload();await A.waitForTimeout(1300);
log('order tile:', (await A.textContent('[data-locked="order"]')).replace(/\s+/g,' '), '| wt:', await A.textContent('.coming [data-wt]'));
await A.click('[data-locked="order"]');await A.waitForTimeout(300);log('after re-tap wt:', await A.textContent('.coming [data-wt]'));
await A.screenshot({path:'/tmp/claude-0/flow/call-active.png'});
await A.click('[data-cancel="order"]');await A.waitForTimeout(400);log('after cancel tile:', (await A.textContent('[data-call="order"]')).replace(/\s+/g,' '));
await A.click('.toast button');await A.waitForTimeout(400);log('after undo locked:', !!(await A.$('[data-locked="order"]')));
await A.click('[data-pserve]');await A.waitForTimeout(400);log('after served tile:', (await A.textContent('[data-locked="order"]')).replace(/\s+/g,' '));
// bill split dishes shared
await A.goto(base+'bill.html');await B.goto(base+'bill.html');await A.waitForTimeout(500);await B.waitForTimeout(500);
await A.click('[data-split="dishes"]');await A.waitForTimeout(2200);await B.click('[data-split="dishes"]');await B.waitForTimeout(800);
log('B payers:', await B.$$eval('.payer', e=>e.map(x=>x.textContent)));log('B unassigned:', await B.textContent('.unas'));
await B.screenshot({path:'/tmp/claude-0/flow/bill-B.png', fullPage:false});
await B.evaluate(()=>SC.scroller.scrollTop=600);await B.waitForTimeout(300);await B.screenshot({path:'/tmp/claude-0/flow/bill-B2.png'});
// stability: wait and check session not reset
const before=await A.evaluate(()=>JSON.parse(localStorage.getItem('sc-masa')).rounds.length);
await A.waitForTimeout(20000);
const after=await A.evaluate(()=>{const s=JSON.parse(localStorage.getItem('sc-masa'));return [s.rounds.length, s.draft.length, Object.keys(s.picks).length];});
log('stability rounds', before, '->', after);
log(errs.join('\n')||'no errors');await b.close();})();
