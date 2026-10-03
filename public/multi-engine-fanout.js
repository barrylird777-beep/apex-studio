function fanoutEscape(v){const d=document.createElement("div");d.textContent=String(v??"");return d.innerHTML}
function fanoutRow(x){return "<div class=\"row\"><div><b>"+fanoutEscape(x.engine)+"</b><span class=\"muted\">"+fanoutEscape(x.query)+"</span></div><span class=\"pill\">"+fanoutEscape(x.status||"-")+"</span></div>"}
function fanoutPreset(){const q=document.getElementById("fanoutQueryPreset");const t=document.getElementById("fanoutQuery");if(q&&t&&!t.value)t.value=q.value}
function fanoutJitter(){const x=document.getElementById("fanoutJitter");const y=document.getElementById("fanoutJitterLabel");if(x&&y)y.textContent="+"+x.value+"ms"}
async function loadFanoutStatus(){try{const x=await api("/api/studio/omni/status");const el=document.getElementById("fanoutMode");if(el)el.textContent=x.mode+" · concurrency "+x.concurrency}catch(e){}}
async function runFanoutUI(){
 const msg=document.getElementById("fanoutMsg"), query=(document.getElementById("fanoutQuery").value||document.getElementById("fanoutQueryPreset").value).trim(); msg.textContent="";
 if(!query){msg.textContent="Enter a research query.";return}
 try{
  const started=performance.now(), max=Number(document.getElementById("fanoutTargetPreset").value||4), jitter=Number(document.getElementById("fanoutJitter").value||20);
  const targetsText=document.getElementById("fanoutTargets")?.value?.trim()||"";
  const targets=targetsText?targetsText.split(/\n+/).map(line=>{const parts=line.split("|");return {engine:(parts[0]||"public").trim(),url:(parts[1]||"").trim(),queryParam:(parts[2]||"q").trim()||"q"}}).filter(x=>x.url):[];
  const x=await api("/api/studio/omni/fanout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query,maxQueries:max,targets})});
  const elapsed=Math.max(1,performance.now()-started+jitter), requests=x.routes||x.subqueries.length*max, throughput=(requests/(elapsed/1000)).toFixed(1);
  document.getElementById("fanoutRequests").textContent=requests+" requests";
  document.getElementById("fanoutLatency").textContent=elapsed.toFixed(1)+" ms";
  document.getElementById("fanoutThroughput").textContent=throughput+" req/s";
  document.getElementById("fanoutSubqueries").innerHTML=x.subqueries.map(fanoutRow).join("")||empty("No sub-queries generated.");
  document.getElementById("fanoutResults").innerHTML=x.results.map(fanoutRow).join("")||empty(targets.length?"No normalized results.":"Simulation only: add approved public targets to execute routes.");
  document.getElementById("fanoutMarkdown").textContent=x.markdown;
  document.getElementById("fanoutJson").textContent=JSON.stringify({orchestrator_query:query,concurrency_limit:max,network_jitter_ms:jitter,fanout_endpoints:x.subqueries.map(q=>({engine:q.engine,status:"completed",matched:x.results.filter(r=>r.engine===q.engine).length}))},null,2);
  msg.className="success"; msg.textContent=x.subqueries.length+" sub-queries · "+x.routes+" routes · "+x.results.length+" unique results";
 }catch(e){msg.className="error";msg.textContent=e.message}
}
window.runFanoutUI=runFanoutUI;window.loadFanoutStatus=loadFanoutStatus;window.addEventListener("DOMContentLoaded",()=>{fanoutPreset();fanoutJitter();document.getElementById("fanoutQueryPreset")?.addEventListener("change",fanoutPreset);document.getElementById("fanoutJitter")?.addEventListener("input",fanoutJitter);loadFanoutStatus()});