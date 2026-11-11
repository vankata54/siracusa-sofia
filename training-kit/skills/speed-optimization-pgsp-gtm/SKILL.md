---
name: "speed-optimization-pgsp-gtm"
description: "Use when the user sends a PageSpeed Insights link or a HAR file (GTmetrix, DevTools) and wants a mobile/desktop speed and SEO analysis of a page."
---

# Speed optimization: PageSpeed + GTmetrix HAR

Reads a full PageSpeed Insights (PSI) report straight from its link, or a HAR file, and returns a short findings report in Bulgarian. The user only sends links or files, no screenshots.

## Output rules (always)

- Reply in Bulgarian, plain human wording. Technical term only in brackets for reference, e.g. "разместване на елементи (CLS)".
- Never use long dashes (em dash or en dash). Use a plain hyphen.
- State only what was found and what can be changed. No hypotheses about causes, no invented prioritisation, no padding.
- Concise, not exhaustive. Group repeated issues instead of listing every file.
- If something could not be read, say so plainly.
- If several pages of the same site were analysed in the conversation, point out what is the same and what is new compared to the earlier pages instead of repeating everything.

## A. PageSpeed Insights link

WebFetch only returns the field data part, the lab report is rendered with JavaScript. Use the built-in browser of the Claude desktop app (read the built-in-browser skill first). The app must be open on the user's computer.

1. Load the browser tools in one ToolSearch call (tabs_context, navigate, preview_start, get_page_text, find, computer, read_page, javascript_tool).
2. Open the link with preview_start (or navigate an existing tab). The same page contains both the mobile and the desktop report, no need to open both URLs.
3. Extract everything with javascript_tool. Wait ~3 s first so the report renders. Use this script:

```js
await new Promise(r=>setTimeout(r,3000));
const t=s=>(s||'').replace(/\s+/g,' ').trim();
const reps=[...document.querySelectorAll('.lh-vars')].filter(r=>r.querySelector('.lh-category'));
const field=[...document.querySelectorAll('[role=tabpanel]')].map(p=>t(p.innerText).split('Диагностициране')[0].slice(0,700));
const dump=rep=>{
 const scores=[...rep.querySelectorAll('.lh-scores-header .lh-gauge__wrapper, .lh-scores-header .lh-fraction__wrapper')].map(w=>t(w.textContent));
 const metrics=[...rep.querySelectorAll('.lh-metric')].map(m=>t(m.querySelector('.lh-metric__title')?.textContent)+': '+t(m.querySelector('.lh-metric__value')?.textContent));
 const audits=[...rep.querySelectorAll('.lh-audit')].filter(a=>!a.closest('.lh-clump--passed, .lh-clump--notapplicable, .lh-clump--manual') && /lh-audit--(fail|average|informative|error)/.test(a.className) && !/Функции на Baseline|Открити библиотеки|CSP|HSTS|COOP|clickjacking|надеждни типове|Трети страни|Дърво на мрежовите/.test(t(a.querySelector('.lh-audit__title')?.textContent))).map(a=>{
  const checks=[...a.querySelectorAll('.lh-checklist-item')].map(i=>t(i.textContent)).join(' ; ');
  const nodes=[...a.querySelectorAll('.lh-node')].slice(0,3).map(n=>t(n.querySelector('.lh-node__snippet')?.textContent).slice(0,160));
  const rows=[...a.querySelectorAll('tbody tr')].slice(0,8).map(r=>[...r.querySelectorAll('td')].map(td=>{const url=td.querySelector('.lh-text__url')?.getAttribute('title'); if(url) return url; const node=td.querySelector('.lh-node__snippet'); if(node) return t(node.textContent).slice(0,110); return t(td.textContent).slice(0,60);}).filter(Boolean).join(' | ').slice(0,220));
  return a.closest('.lh-category')?.id.slice(0,4)+' :: '+t(a.querySelector('.lh-audit__title')?.textContent)+' :: '+t(a.querySelector('.lh-audit__display-text')?.textContent)+(checks?' [['+checks+']]':'')+'\n   nodes: '+nodes.join(' / ')+'\n   '+rows.join('\n   ');
 });
 return scores.join(', ')+'\n'+metrics.join(', ')+'\n'+audits.join('\n');
};
field.join('\n---\n')+'\n=====MOBILE\n'+dump(reps[0])+'\n=====DESKTOP\n'+dump(reps[1])
```

   - reps[0] is mobile, reps[1] is desktop.
   - In the LCP discovery checklist, wording like "Трябва да се приложи fetchpriority=high" means it is missing, "Приложено е" means it passes.
   - get_page_text on PSI often returns only the report CSS, and read_page output is huge. Prefer the script.
4. Open the tested page itself in the same tab to check what the report only points to by code:
   - Identify Elementor containers by `[data-id="..."]` (text and images inside) so you can name them in plain words (e.g. "основният блок с текста на статията").
   - Check `meta[name=description]`, the LCP image `fetchpriority` and `loading`, and the JSON-LD types (e.g. a blog post with no Article/BlogPosting).
   - If PSI says robots.txt timed out, open /robots.txt and report whether it actually loads.

### Report structure

1. One line: what page, that it is a single lab test on an emulated device so numbers vary between runs (only on the first analysis in a conversation).
2. Scores table: Ефективност, Достъпност, Най-добри практики, SEO, mobile vs desktop.
3. Metrics table: FCP, LCP, TBT, CLS, Speed Index, mobile vs desktop.
4. Field data (real users): values, or that there is not enough data, and whether it is page-level or falls back to the whole domain. If lab CLS is low but field CLS fails, say the lab test does not capture the cause.
5. "Какво е намерено (ефективност)": numbered, most impactful first by the report's own estimated savings. Typical items: LCP element and its breakdown, CLS culprits, images (file, size, displayed size), caching, render-blocking files, fonts without font-display, duplicated files, unused JS/CSS, long tasks, page weight, video.
6. SEO, Достъпност, Най-добри практики: short bullets of failing checks only. Skip the generic security headers (CSP, HSTS, COOP, XFO, Trusted Types) unless asked.

## B. HAR file (GTmetrix or DevTools)

A HAR file has every network request with timings and response headers. It has no scores or recommendations (those are in the GTmetrix PDF report).

1. Copy the file to its own empty folder in the scratchpad and parse it with Python run as `python3 -I`.
2. Summarise: tested URL and page title, page timings from `pages[].pageTimings` (FCP, LCP, onLoad, fully loaded), number of requests, total transfer, split by file type and by host, HTTP versions, status codes other than 200.
3. Check response headers of the site's own files: `Cache-Control` / `Expires` (caching), `Content-Encoding` (compression), `Server`, and cache plugin headers on the HTML document (e.g. `WPO-Cache-Status`, `X-Cache`, `CF-Cache-Status`). Quote the header when it explains the result.
4. Rebuild the waterfall: sort entries by `startedDateTime`, compute start and end relative to the first request, and use `timings` (`_blocked_queueing` = waiting in queue, `wait` = server time, `receive` = download). Report it as a short time table: server wait for the HTML, the burst of requests, which files queue longest, fonts, FCP/LCP moments, and which request finishes last (what sets "fully loaded").
5. For admin-ajax.php or other XHR, show the `action` from the POST data and how long it waits.
6. Note when the tested URL carries tracking parameters (e.g. `?_gl=`), and if a cache header says the page was not cached because of them, suggest re-testing with a clean URL.
7. Offer to draw the waterfall as a chart if it would help.