(() => {
const style=document.createElement("style");
style.textContent=`
:root{--bg:#100d0a;--panel:rgba(40,30,22,.74);--panel2:rgba(29,22,17,.86);--line:rgba(246,224,190,.12);--line-strong:rgba(246,224,190,.24);--text:#fff8ef;--muted:#b7a797;--holy:#c8a46a;--corn:#e3b85c;--shadow:0 24px 70px rgba(0,0,0,.34);--radius:22px}
body{background:radial-gradient(900px 500px at 72% -8%,rgba(200,164,106,.16),transparent 60%),radial-gradient(700px 500px at 0 30%,rgba(112,78,43,.15),transparent 62%),linear-gradient(180deg,#17110d 0%,#0b0806 100%) !important;color:var(--text)!important}
body:before{opacity:.09!important} header{background:rgba(16,12,9,.78)!important;border-color:var(--line)!important} aside{background:rgba(19,14,10,.72)!important;border-color:var(--line)!important}
.panel,.card,.notice{background:linear-gradient(145deg,rgba(52,39,29,.78),rgba(24,18,14,.82))!important;border-color:var(--line)!important;box-shadow:var(--shadow)!important}.panel{border-radius:var(--radius)!important}
.brand{letter-spacing:.16em!important}.brand:after{content:"  ·  BIBLICALLY SEEN";color:var(--holy);font-weight:850;letter-spacing:.08em}
.nav button.active{background:linear-gradient(90deg,rgba(200,164,106,.18),rgba(200,164,106,.04))!important;border-color:rgba(200,164,106,.24)!important;color:#fff3dc!important}
button.primary{background:linear-gradient(180deg,#f6e8d2,#d6b887)!important;color:#20160d!important;border-color:rgba(255,238,208,.62)!important}
.eyebrow{color:var(--holy)!important;letter-spacing:.16em!important}
.cornnut{display:inline-flex;gap:2px;align-items:center;white-space:nowrap}.cornnut i{font-style:normal;filter:drop-shadow(0 2px 4px rgba(227,184,92,.22))}
.crew-badge{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.035);font-weight:800}
`;
document.head.appendChild(style);
const originalView=window.view;
window.view=function(name){if(name==="bible")setTimeout(()=>document.title="HOLY MOLY · BIBLICALLY SEEN",0);return originalView?originalView(name):undefined};
const decorate=()=>{document.querySelectorAll(".nav button").forEach(btn=>{const t=(btn.textContent||"").trim();if(t==="Bible Library")btn.textContent="HOLY MOLY";if(t==="Sacred Library")btn.textContent="HOLY MOLY · Library";if(t==="Apex Command")btn.textContent="BIBLICALLY SEEN";if(t==="Quirk Lab")btn.textContent="CornNut Lab"});document.querySelectorAll(".top h1,h1").forEach(h=>{if((h.textContent||"").trim()==="Apex Bible Story Studio")h.textContent="BIBLICALLY SEEN";if((h.textContent||"").trim()==="Bible Library")h.textContent="HOLY MOLY"})};
decorate();
const godDid=()=>{if(document.getElementById("god-did-easter-egg"))return;const el=document.createElement("div");el.id="god-did-easter-egg";el.textContent="GOD DID";el.setAttribute("aria-label","GOD DID");el.style.cssText="position:fixed;right:18px;bottom:14px;z-index:9999;font-size:10px;font-weight:900;letter-spacing:.28em;color:rgba(246,224,190,.42);pointer-events:none;user-select:none;text-shadow:0 1px 8px rgba(0,0,0,.35)";document.body.appendChild(el)};
godDid();new MutationObserver(()=>{decorate();godDid()}).observe(document.body,{childList:true,subtree:true});
})();