const {chromium}=require('playwright');
const base='file:///home/user/siracusa-sofia/design/pages-masa/';
(async()=>{const b=await chromium.launch();
for (let i=0;i<5;i++){ const ctx=await b.newContext({viewport:{width:390,height:844}});
await ctx.addInitScript(()=>{ if(!localStorage.getItem('sc-cookie')){localStorage.setItem('sc-cookie','"min"');localStorage.setItem('sc-prefs',JSON.stringify({theme:'light',view:'phone',time:'19:30'}));} });
const A=await ctx.newPage(), B=await ctx.newPage();
await A.goto(base+'welcome.html');await A.waitForTimeout(600);
const ka=await A.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('tab')).map(k=>k+'='+localStorage.getItem(k)));
await B.goto(base+'cart.html');
const kb=await B.evaluate(()=>[MASA.me, window.name, Object.keys(localStorage).filter(k=>k.includes('tab')).map(k=>k+'='+localStorage.getItem(k))]);
await B.waitForTimeout(3000);
console.log(i, JSON.stringify(ka), JSON.stringify(kb), await A.evaluate(()=>MASA.me), await B.evaluate(()=>MASA.me)); await ctx.close(); }
await b.close();})();
