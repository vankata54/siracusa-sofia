const {chromium}=require('playwright');const base='http://127.0.0.1:8765/pages-masa/';
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:360,height:780}});
await ctx.addInitScript(()=>{localStorage.setItem('sc-cookie','"min"');localStorage.setItem('sc-prefs',JSON.stringify({theme:'light',view:'phone',time:'19:30'}));});
const p=await ctx.newPage();
for (const u of ['welcome.html','menu.html','cart.html#demo=cooking','call.html#demo=called','bill.html#demo=bill','bill.html#demo=rated']){ await p.goto(base+u);await p.waitForTimeout(700);
 if(u.includes('#demo=bill')){await p.click('[data-split="dishes"]');await p.waitForTimeout(2000);}
 const r=await p.evaluate(()=>{const sc=SC.scroller;const small=[...document.querySelectorAll('.mtab,.mnav a,.mnav button,.tile,.pill,.chip')].filter(e=>{const b=e.getBoundingClientRect();return b.width&&(b.height<48)}).map(e=>e.className+':'+Math.round(e.getBoundingClientRect().height));return {overflow:sc.scrollWidth-sc.clientWidth, small:small.slice(0,5)};});
 console.log(u, JSON.stringify(r)); if(u.includes('#demo=bill')){ await p.screenshot({path:'/tmp/claude-0/flow/bill360.png'}); } }
await b.close();})();
