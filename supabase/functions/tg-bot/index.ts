// بوت تليكرام @DafterGoldBot — ربط المحلات بالتقارير اليومية
// المتغيرات: TG_TOKEN (من BotFather)، والباقي يوفّره Supabase تلقائياً
const TG = Deno.env.get("TG_TOKEN") ?? "";
const SB = Deno.env.get("SUPABASE_URL") ?? "";
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function secret(): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dafter-webhook|" + TG));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}
const db = (path: string, init: RequestInit = {}) =>
  fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
const tg = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const say = (chat: number, text: string) => tg("sendMessage", { chat_id: chat, text });

const HELP =
  "أهلاً بيك ببوت دفتر الذهب 📒\n\n" +
  "حتى توصلك التقارير، افتح التطبيق ← الإعدادات ← «تقارير تليكرام» ← اضغط «ربط حساب تليكرام».\n\n" +
  "التقارير:\n• كل يوم الساعة ١٠ بالليل: ملخص اليوم PDF\n• يوم ١ من كل شهر: تقرير الشهر الي فات\n\n" +
  "لإيقاف التقارير اكتب /stop";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // تفعيل الويب هوك مرة وحدة: افتح رابط الدالة وبآخره ?setup=1
  if (req.method === "GET" && url.searchParams.get("setup") === "1") {
    if (!TG) return new Response("TG_TOKEN غير موجود بالإعدادات", { status: 500 });
    const self = `${SB}/functions/v1/tg-bot`;
    const r = await tg("setWebhook", { url: self, secret_token: await secret(), allowed_updates: ["message"], drop_pending_updates: true });
    await tg("setMyCommands", { commands: [{ command: "start", description: "البداية" }, { command: "stop", description: "إيقاف التقارير" }] });
    const j = await r.json();
    return new Response(j.ok ? "✅ تم تفعيل البوت" : "❌ " + JSON.stringify(j), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (req.method !== "POST" || req.headers.get("x-telegram-bot-api-secret-token") !== (await secret())) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const up = await req.json();
    const m = up.message;
    if (!m || !m.chat || m.chat.type !== "private" || typeof m.text !== "string") return new Response("ok");
    const chat: number = m.chat.id;
    const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ").slice(0, 80);
    const [cmd, arg] = m.text.trim().split(/\s+/);

    if (cmd === "/start" && arg && /^[a-f0-9]{32}$/.test(arg)) {
      const r = await db(`tg_tokens?token=eq.${arg}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=shop_id`);
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) {
        await say(chat, "⚠️ رابط الربط منتهي أو مستخدم. ارجع للتطبيق واضغط «ربط حساب تليكرام» مرة ثانية.");
        return new Response("ok");
      }
      const shop = rows[0].shop_id;
      await db("tg_links?on_conflict=chat_id,shop_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ chat_id: chat, shop_id: shop, name }),
      });
      await db(`tg_tokens?token=eq.${arg}`, { method: "DELETE" });
      const s = await (await db(`shops?id=eq.${encodeURIComponent(shop)}&select=store`)).json();
      const store = s?.[0]?.store ?? "";
      await say(
        chat,
        `✅ تم ربط محل «${store}» بنجاح\n\n` +
          "راح يوصلك:\n• كل يوم الساعة ١٠ بالليل: ملخص اليوم PDF\n• يوم ١ من كل شهر: تقرير الشهر الي فات\n\nلإيقاف التقارير اكتب /stop",
      );
      return new Response("ok");
    }

    if (cmd === "/stop") {
      await db(`tg_links?chat_id=eq.${chat}`, { method: "DELETE" });
      await say(chat, "تم إيقاف التقارير ✅\nتگدر ترجع تربط من إعدادات التطبيق بأي وقت.");
      return new Response("ok");
    }

    await say(chat, HELP);
  } catch (e) {
    console.error(e);
  }
  return new Response("ok");
});
