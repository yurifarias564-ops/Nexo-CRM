import { appUrl } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Script para o site da empresa: guarda de onde o visitante veio (UTMs, fbclid, gclid) e
 * troca os botões/links de WhatsApp pelo link rastreado. Uso:
 * <script src="https://SEU-CRM/api/t/SLUG" async></script>
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return new Response("// slug inválido", { status: 404, headers: { "content-type": "application/javascript" } });
  const base = appUrl();
  const js = `(function(){try{
var B=${JSON.stringify(`${base}/r/${slug}`)},K="nexo_trk",D=30*864e5,P=["utm_source","utm_medium","utm_campaign","utm_content","utm_term","fbclid","gclid","ttclid"];
var u=new URLSearchParams(location.search),s={};try{s=JSON.parse(localStorage.getItem(K)||"{}")}catch(e){}
var got=P.some(function(k){return u.get(k)});
if(got||!s.t||Date.now()-s.t>D){s={t:Date.now(),ref:document.referrer||"",page:location.href.split("#")[0]};P.forEach(function(k){if(u.get(k))s[k]=u.get(k)})}
try{localStorage.setItem(K,JSON.stringify(s))}catch(e){}
function go(phone,text){var q=new URLSearchParams();P.forEach(function(k){if(s[k])q.set(k,s[k])});if(phone)q.set("to",phone);if(text)q.set("text",text);if(s.ref)q.set("ref",s.ref);q.set("page",s.page||location.href);return B+"?"+q.toString()}
window.nexoWhatsApp=function(phone,text){location.href=go(phone,text)};
function parse(h){try{var x=new URL(h,location.href);var host=x.hostname.replace("www.","");
if(host==="wa.me")return{p:x.pathname.replace(/\\D/g,""),t:x.searchParams.get("text")||""};
if(host==="api.whatsapp.com"||host==="web.whatsapp.com")return{p:(x.searchParams.get("phone")||"").replace(/\\D/g,""),t:x.searchParams.get("text")||""};
if(x.protocol==="whatsapp:")return{p:(x.searchParams.get("phone")||"").replace(/\\D/g,""),t:x.searchParams.get("text")||""};}catch(e){}return null}
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var w=parse(a.getAttribute("href"));if(!w)return;e.preventDefault();var url=go(w.p,w.t);if(a.target==="_blank")window.open(url,"_blank");else location.href=url},true);
}catch(e){}})();`;
  return new Response(js, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}
