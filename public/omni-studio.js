(function(){
let omniHandshake=null, omniSourceCache=[];
function omniLog(value,kind=""){const el=$("omniTerminal");const line=typeof value==="string"?value:JSON.stringify(value,null,2);el.textContent+="\n"+line;if(kind)el.lastChild?.classList?.add(kind);el.scrollTop=el.scrollHeight}
async function omniParseProsody(){try{const x=await api("/api/studio/omni/prosody",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:$("omniProsody").value})});$("omniAudioOut").textContent=JSON.stringify(x,null,2)}catch(e){$("omniAudioOut").textContent=e.message}}
async function omniStereo(){try{const x=await api("/api/studio/omni/stereo",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({width:.35,pan:0,law:"mid-side"})});$("omniAudioOut").textContent=JSON.stringify(x,null,2)}catch(e){$("omniAudioOut").textContent=e.message}}
async function omniRiskChoice(approved){if(!omniHandshake)return;$("omniRiskModal").classList.remove("open");try{await api("/api/studio/omni/risk/"+encodeURIComponent(omniHandshake.id)+"/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approved})});if(approved)omniRunApproved();else omniLog("Risk review cancelled; returned to STANDARD.","warn")}catch(e){omniLog(e.message,"warn")}}
async function omniRunApproved(){const q=$("omniQuery").value,sources=$("omniSources").value.split("\n").map(x=>x.trim()).filter(Boolean);await omniExecute(q,sources,omniHandshake?.id)}
async function omniSearch(){
 const q=$("omniQuery").value,sources=$("omniSources").value.split("\n").map(x=>x.trim()).filter(Boolean);
 $("omniMode").textContent=q.includes("[WILLY-NILLY]")?"ELEVATED REVIEW":"STANDARD";
 if(sources.length){
   try{omniHandshake=await api("/api/studio/omni/risk",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:q,sources,writes:[]})});$("omniRiskPre").textContent=JSON.stringify(omniHandshake.report,null,2);$("omniRisk").textContent="Outbound retrieval paused pending YES/NO.";$("omniRiskModal").classList.add("open");}catch(e){omniLog(e.message,"warn")}
   return;
 }
 await omniExecute(q,[],null);
}
async function omniExecute(q,sources,handshakeId){
 omniLog("\n[SE-X] "+new Date().toISOString()+" query="+q);
 try{
  const x=await api("/api/studio/omni/search",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:q,sources,handshakeId,inject:true})});
  omniLog("[SE-X] fragments="+JSON.stringify(x.fragments));x.results.forEach(r=>omniLog(r.error?"ERROR "+r.error:"["+r.status+"] "+r.url+"\n"+(r.text||"(non-text response)")));
  if(x.injection)omniLog("[INJECT] stored as unverified research "+x.injection.researchId,"ok");
 }catch(e){omniLog("[SE-X] "+e.message,"warn")}
}
async function omniNarrative(){try{const x=await api("/api/studio/omni/narrative",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:$("omniTrackTitle").value,branchId:$("omniBranch").value,blocks:[{text:$("omniBlock").value,visualFrames:{start:Number($("omniFrameStart").value),end:Number($("omniFrameEnd").value)},vocal:{}}]})});$("omniNarrativeOut").innerHTML="<div class='row'><b>"+esc(x.title)+"</b><span class='pill'>"+esc(x.branchId)+" · "+x.blocks.length+" block</span></div>"}catch(e){$("omniNarrativeOut").innerHTML=empty(e.message)}}
function omniClear(){$("omniTerminal").textContent="Waiting for query."}
window.omniSearch=omniSearch;window.omniRiskChoice=omniRiskChoice;window.omniParseProsody=omniParseProsody;window.omniStereo=omniStereo;window.omniNarrative=omniNarrative;window.omniClear=omniClear;
setInterval(async()=>{try{const jobs=await api("/api/studio/renders");$("omniRenderConsole").textContent=jobs.slice(-12).map(j=>new Date().toLocaleTimeString()+"  "+j.id+"  "+j.status+"  "+(j.progress??"")).join("\\n")||"No active render jobs."}catch{}} ,2000);
const omniEvents=new EventSource("/api/studio/omni/events");omniEvents.addEventListener("sex.started",e=>omniLog("[EVENT] started "+JSON.parse(e.data).id));omniEvents.addEventListener("sex.complete",e=>omniLog("[EVENT] complete "+JSON.parse(e.data).id,"ok"));
})();