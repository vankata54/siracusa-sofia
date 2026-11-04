const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:390,height:844}});
await p.addInitScript(()=>{localStorage.setItem('sc-prefs',JSON.stringify({theme:'dark',view:'phone',time:'19:30'}));localStorage.setItem('sc-cookie','"min"');localStorage.setItem('sc-masa',JSON.stringify(null));});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file:///home/user/siracusa-sofia/design/pages-masa/welcome.html');await p.waitForTimeout(800);
await p.click('[data-mlang="en"]');await p.waitForTimeout(1000);await p.screenshot({path:'/tmp/masa-en-welcome.png'});
await p.goto('file:///home/user/siracusa-sofia/design/pages-masa/call.html');await p.waitForTimeout(800);await p.click('[data-call="order"]');await p.waitForTimeout(600);await p.screenshot({path:'/tmp/masa-en-call.png'});
await p.click('[data-mprofile]');await p.waitForTimeout(600);await p.screenshot({path:'/tmp/masa-en-profile.png'});
await p.goto('file:///home/user/siracusa-sofia/design/pages-masa/menu.html');await p.waitForTimeout(800);await p.click('[data-madd]');await p.waitForTimeout(300);await p.click('[data-mdish="pitsa-margarita"]');await p.waitForTimeout(600);await p.screenshot({path:'/tmp/masa-en-dish.png'});
console.log(errs.join('\n')||'no errors');await b.close();})();
