/* Siracusa · Админ: помощници за резервациите, залата, клиентите и настройките (автор 3). Само функции и стойности по подразбиране,
   без данни. Зарежда се след _admin.js и преди _seed-res.js на екраните на автор 3. Екранът работи и без примерните данни
   (_seed-res.js): тогава показва празно състояние.
   A.rl.today()          "2026-11-15" по часа на прототипа A.now() (София)
   A.rl.nowMin()         минути от полунощ по часа на прототипа
   A.rl.isoAt(ден, мин)  ISO за ден и час по София
   A.rl.addDays(ден, n)  ден ± n дни
   A.rl.tables()         планът: sa-tables или условните SC.TABLES ({tables, joins, garden})
   A.rl.SETTINGS         настройките по подразбиране (като src/core/settings.ts + новите полета)
   A.rl.settings()       sa-settings, допълнени със стойностите по подразбиране
   A.rl.fmtPhone(p)      "0888 12 34 56";  A.rl.maskPhone(p)  "0888 ** ** 56"
   A.rl.phoneOf(i)       примерен телефон за „Клиент i+1“ (за примерните данни; не е истински номер) */
(function(){
"use strict";
var A = window.A; if (!A || !A.data) return;
var R = A.rl = A.rl || {};
function now(){ return A.now ? A.now() : new Date(); }
function ymd(d){ return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }
function parse(k){ var p = k.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], 10)); }
R.addDays = function(k, n){ var d = parse(k); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
R.today = function(){ var s = A.sofia(now()); return s.y + "-" + String(s.mo + 1).padStart(2, "0") + "-" + String(s.d).padStart(2, "0"); };
R.nowMin = function(){ var s = A.sofia(now()); return s.h * 60 + s.m; };
/* зимно време UTC+2, лятно UTC+3: отместването се проверява с A.sofia */
R.isoAt = function(day, min){ var d = parse(day); d.setUTCHours(0, 0, 0, 0); var t = d.getTime() + (min - 120) * 60000, s = A.sofia(new Date(t)), off = s.h * 60 + s.m - min; return new Date(t - off * 60000).toISOString(); };
R.fmtPhone = function(p){ p = String(p || ""); return p.length === 10 ? p.slice(0, 4) + " " + p.slice(4, 6) + " " + p.slice(6, 8) + " " + p.slice(8) : p; };
R.maskPhone = function(p){ p = String(p || "").replace(/\s/g, ""); return p.length >= 6 ? p.slice(0, 4) + " ** ** " + p.slice(-2) : p; };
R.phoneOf = function(i){ return "08" + ["88","87","89","98","99","95"][i % 6] + String((i * 791 * 37 + 123457) % 1000000).padStart(6, "0"); };
R.tables = function(){ var d = A.data.get("tables", null); if (d && d.tables) return d;
  return {tables:SC.TABLES.map(function(t){ return {id:t.id, n:t.n, zone:t.zone, seats:t.seats, shape:t.shape, cx:110 + t.x * 193, cy:100 + t.y * 200, window:t.window, stroller:t.stroller, access:t.access, walkin:true}; }), joins:[], garden:true}; };
R.SETTINGS = {kitchen:{busy:false, etaMin:35, etaBusyMin:55, busyAt:null}, resMinutes:120, celebrationPrice:"offer", earlyDays:null, noShowLimit:2, callCooldown:3, callManager:5};
R.settings = function(){ var s = A.data.get("settings", {}) || {}, o = JSON.parse(JSON.stringify(R.SETTINGS)); Object.keys(s).forEach(function(k){ if (k !== "kitchen") o[k] = s[k]; }); o.kitchen = Object.assign(o.kitchen, s.kitchen || {}); return o; };
})();
