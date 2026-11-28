// يرسل تقارير دفتر الذهب على تليكرام: ملخص اليوم كل ليلة، وتقرير الشهر يوم ١
// المتغيرات: SB_URL, SB_SERVICE_KEY, TG_TOKEN — واختياري: DAY=YYYY-MM-DD, ONLY_SHOP, FORCE=1
import { chromium } from "playwright-core";

const SB = process.env.SB_URL, SK = process.env.SB_SERVICE_KEY, TG = process.env.TG_TOKEN;
if (!SB || !SK || !TG) { console.error("missing secrets"); process.exit(1); }
const APP = process.env.APP_URL || "https://dafterapp.online/";

// الجدولة تبدي قبل الوقت (GitHub يتأخر أحياناً) وتنتظر لحد 10:00 بالليل بتوقيت بغداد
if (process.env.WAIT_22 === "1") {
  const now = new Date(), target = new Date(now); target.setUTCHours(19, 0, 0, 0);
  const ms = target - now;
  if (ms > 0 && ms < 50 * 60e3) { console.log(`waiting ${Math.round(ms / 1000)}s until 22:00 Baghdad`); await new Promise((r) => setTimeout(r, ms)); }
}
const baghdadToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const DAY = process.env.DAY || baghdadToday();
const FORCE = process.env.FORCE === "1";
const prevMonth = (d) => { const [y, m] = d.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
const MONTHLY = DAY.endsWith("-01") || process.env.MONTHLY === "1";
const MONTH = prevMonth(DAY);
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const dmy = (d) => d.split("-").reverse().join("/");
const wStr = (mg) => `${fmt(Math.floor(mg / 1000))} غ و ${mg % 1000} ملغ`;

const db = async (path, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
};
// يسجّل الإرسال؛ يرجّع false إذا انرسل قبل (حتى لو الوظيفة اشتغلت مرتين)
const claim = async (shop, day, kind) => {
  if (FORCE) return true;
  const r = await db("tg_log?on_conflict=shop_id,day,kind", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ shop_id: shop, day, kind }) });
  return Array.isArray(r) && r.length > 0;
};
const unclaim = (shop, day, kind) => db(`tg_log?shop_id=eq.${encodeURIComponent(shop)}&day=eq.${day}&kind=eq.${kind}`, { method: "DELETE" }).catch(() => {});

async function tgSend(method, chat, fields, file) {
  const fd = new FormData();
  fd.append("chat_id", String(chat));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append("document", new Blob([file.buf], { type: "application/pdf" }), file.name);
  const r = await fetch(`${process.env.TG_API || "https://api.telegram.org"}/bot${TG}/${method}`, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { const e = new Error(j.description || "tg " + r.status); e.code = j.error_code; throw e; }
}

const links = await db("tg_links?select=chat_id,shop_id" + (process.env.ONLY_SHOP ? `&shop_id=eq.${encodeURIComponent(process.env.ONLY_SHOP)}` : ""));
const byShop = new Map();
for (const l of links) { if (!byShop.has(l.shop_id)) byShop.set(l.shop_id, []); byShop.get(l.shop_id).push(l.chat_id); }
console.log(`day=${DAY} monthly=${MONTHLY ? MONTH : "no"} shops=${byShop.size} chats=${links.length}`);
if (!byShop.size) process.exit(0);

const ids = [...byShop.keys()].map(encodeURIComponent).join(",");
const [shops, clients] = await Promise.all([
  db(`shops?id=in.(${ids})&select=id,store,data`),
  db(`clients?id=in.(${ids})&select=id,exp`),
]);
const expOf = Object.fromEntries(clients.map((c) => [c.id, c.exp ? String(c.exp).slice(0, 10) : null]));

const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || "chrome" });
const page = await browser.newPage();
await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForFunction(() => typeof window.dafterReport === "function", null, { timeout: 30000 });

let sent = 0, failed = 0;
for (const shop of shops) {
  const chats = byShop.get(shop.id) || [];
  const exp = expOf[shop.id];
  if (!exp || exp < DAY) { console.log(`skip ${shop.id}: subscription ended (${exp})`); continue; }
  const store = shop.data?.settings?.store || shop.store || "";
  const jobs = [["daily", DAY]];
  if (MONTHLY) jobs.push(["monthly", MONTH]);
  for (const [kind, arg] of jobs) {
    const logDay = kind === "daily" ? DAY : `${MONTH}-01`;
    if (!(await claim(shop.id, logDay, kind))) { console.log(`already sent ${shop.id} ${kind}`); continue; }
    try {
      const r = await page.evaluate(([d, k, a]) => window.dafterReport(d, k, a), [shop.data || {}, kind, arg]);
      const buf = Buffer.from(r.b64, "base64");
      let caption, file = { buf, name: r.name };
      if (kind === "daily") {
        const s = r.stats;
        caption = s.n || s.pay
          ? `📒 ملخص يوم ${dmy(DAY)}\n🏪 ${store}\n\n▲ البيع: ${s.s.count} قطعة — ${wStr(s.s.mg)}\n     ${fmt(s.s.price)} د.ع\n▼ الشراء: ${s.p.count} قطعة — ${wStr(s.p.mg)}\n     ${fmt(s.p.price)} د.ع\n⚖️ الفرق: ${fmt(s.s.price - s.p.price)} د.ع` + (s.pay ? `\n💰 تسديدات ديون: ${fmt(s.pay)} د.ع` : "")
          : null;
        if (!caption) { file = null; }
      } else {
        caption = `📊 التقرير الشهري\n🏪 ${store}\n\nتفاصيل الشهر كاملة بالملف: البيع والشراء يوم بيوم، حسب العيار، حسب الموظف، والديون.`;
      }
      for (const chat of chats) {
        try {
          if (file) await tgSend("sendDocument", chat, { caption }, file);
          else await tgSend("sendMessage", chat, { text: `📒 ملخص يوم ${dmy(DAY)}\n🏪 ${store}\n\nما أكو بيع أو شراء اليوم.` });
          sent++;
        } catch (e) {
          failed++; console.log(`send fail ${shop.id} → ${chat}: ${e.message}`);
          if (e.code === 403) await db(`tg_links?chat_id=eq.${chat}`, { method: "DELETE" }).catch(() => {}); // المستخدم حظر البوت
        }
        await new Promise((res) => setTimeout(res, 120));
      }
    } catch (e) {
      failed++; console.log(`report fail ${shop.id} ${kind}: ${e.message}`);
      await unclaim(shop.id, logDay, kind);
    }
  }
}
await browser.close();
console.log(`done: sent=${sent} failed=${failed}`);
