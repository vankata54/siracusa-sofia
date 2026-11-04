const {chromium}=require('playwright');
const base='file:///home/user/siracusa-sofia/design/pages-masa/';
(async()=>{const b=await chromium.launch();
for (let i=0;i<4;i++){ const ctx=await b.newContext({viewport:{width:390,height:844}});
const A=await ctx.newPage(), B=await ctx.newPage();
await A.goto(base+'welcome.html');await A.waitForTimeout(600);await B.goto(base+'cart.html');
const first=await B.evaluate(()=>MASA.me); await B.waitForTimeout(3500);
console.log('run',i,'A',await A.evaluate(()=>MASA.me),'B first',first,'B after 3.5s',await B.evaluate(()=>MASA.me)); await ctx.close(); }
await b.close();})();
