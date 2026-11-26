// يخلي التطبيق يشتغل بدون إنترنت. غيّر رقم النسخة كل ما تحدّث الملفات حتى تتحدث عند المحلات.
const VERSION='dafter-v9';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./favicon-64.png','./rendr-logo.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const url=new URL(r.url);
  if(url.searchParams.has('ts'))return;   // فحص الوقت يروح للسيرفر مباشرة
  // صفحة التطبيق: من الإنترنت أولاً حتى توصل التحديثات، وإذا ماكو نت من النسخة المحفوظة
  if(r.mode==='navigate'){e.respondWith(fetch(r).then(res=>{const cp=res.clone();caches.open(VERSION).then(c=>c.put('./index.html',cp));return res}).catch(()=>caches.match('./index.html')));return}
  // الخطوط والأيقونات: من المحفوظ أولاً
  if(url.origin===location.origin||url.host.includes('fonts.g')){
    e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok||res.type==='opaque'){const cp=res.clone();caches.open(VERSION).then(c=>c.put(r,cp))}return res})));
  }
});
