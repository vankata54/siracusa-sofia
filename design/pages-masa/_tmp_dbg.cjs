const {chromium}=require('playwright');
const base='file:///home/user/siracusa-sofia/design/pages-masa/';
(async()=>{const b=await chromium.launch();const ctx=await b.newContext();
const A=await ctx.newPage(), B=await ctx.newPage();
await A.goto(base+'welcome.html');await A.waitForTimeout(600);
console.log('A', await A.evaluate(()=>[window.name, MASA.me, localStorage.getItem('sc-masa-tabs')]));
await B.goto(base+'cart.html');await B.waitForTimeout(600);
console.log('B', await B.evaluate(()=>[window.name, MASA.me, localStorage.getItem('sc-masa-tabs')]));
await b.close();})();
