(function(){
let visionScenes=[],visionSelected=null,visionSearchTimer=null;
function renderVisionScenes(items){
  $("visionSceneList").innerHTML=items.map(x=>"<button class=\"row\" style=\"text-align:left;width:100%\" data-vision-id=\""+esc(x.id)+"\"><div><b>"+esc(x.title)+"</b><span class=\"muted\">"+(x.shots?.length??0)+" shots · "+esc(x.status||"draft")+"</span></div><span class=\"pill\">"+esc(x.id)+"</span></button>").join("")||empty("No scenes match.");$("visionSceneList").querySelectorAll("[data-vision-id]").forEach(b=>b.addEventListener("click",()=>selectVisionScene(b.dataset.visionId)));
  $("visionSceneList").innerHTML=items.map(x=>"<button class='row' style='text-align:left;width:100%' onclick='selectVisionScene(""+esc(x.id)+"")'><div><b>"+esc(x.title)+"</b><span class='muted'>"+(x.shots?.length??0)+" shots · "+esc(x.status||"draft")+"</span></div><span class='pill'>"+esc(x.id)+"</span></button>").join("")||empty("No scenes match.");
}
async function loadVisionEditor(){try{const a=await api("/api/studio/scenes");renderVisionScenes(a);if(visionSelected)selectVisionScene(visionSelected.id)}catch(e){$("visionSceneList").innerHTML=empty(e.message)}}
async function visionSearch(){
  clearTimeout(visionSearchTimer);
  visionSearchTimer=setTimeout(async()=>{try{
    const q=$("visionSearch").value.trim();
    if(!q){renderVisionScenes(await api("/api/studio/scenes"));return}
    const hits=await api("/api/studio/editor/search?q="+encodeURIComponent(q)+"&limit=30");
    renderVisionScenes(hits.filter(x=>x.type==="scenes").map(x=>x.item||x));
  }catch(e){$("visionSceneList").innerHTML=empty(e.message)}},180);
}
async function selectVisionScene(id){
  try{const scenes=await api("/api/studio/scenes");const s=scenes.find(x=>x.id===id);if(!s)return;visionSelected=s;
    $("visionInspector").innerHTML="<div class='form'><label>Scene title</label><input id='vTitle' value='"+esc(s.title)+"'><label>Notes</label><textarea id='vNotes'>"+esc(s.notes||"")+"</textarea><label>Location ID</label><input id='vLocation' value='"+esc(s.locationId||"")+"'><label>Status</label><select id='vStatus'><option>draft</option><option>review</option><option>approved</option></select><button class='primary' onclick='saveVisionScene()'>Save scene</button></div><h3>Source provenance</h3><div class='list'>"+((s.sourceRefs||[]).map(r=>"<div class='row'><div><b>"+esc(r.locator||r.reference||r.sourceId||"Source reference")+"</b><span class='muted'>"+esc(r.sourceClass||r.kind||"source")+"</span></div></div>").join("")||empty("No source references attached."))+"</div><h3>Shots</h3><div class='list'>"+((s.shots||[]).map(x=>"<div class='row'><div><b>"+esc((x.index??0)+1)+". "+esc(x.type||"shot")+"</b><span class='muted'>"+esc(x.visualPrompt||x.description||"")+"</span></div></div>").join("")||empty("No shots yet."))+"</div>";
    $("vStatus").value=s.status||"draft";
  }catch(e){$("visionInspector").innerHTML=empty(e.message)}
}
async function saveVisionScene(){
  if(!visionSelected)return;
  try{const patch={title:$("vTitle").value,notes:$("vNotes").value,locationId:$("vLocation").value||null,status:$("vStatus").value};
    visionSelected=await api("/api/studio/editor/scenes/"+encodeURIComponent(visionSelected.id),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(patch)});
    await loadVisionEditor();
  }catch(e){alert(e.message)}
}
async function visionUndo(){try{await api("/api/studio/editor/undo",{method:"POST"});await loadVisionEditor();if(visionSelected)selectVisionScene(visionSelected.id)}catch(e){alert(e.message)}}
async function visionRedo(){try{await api("/api/studio/editor/redo",{method:"POST"});await loadVisionEditor();if(visionSelected)selectVisionScene(visionSelected.id)}catch(e){alert(e.message)}}
window.loadVisionEditor=loadVisionEditor;window.visionSearch=visionSearch;window.selectVisionScene=selectVisionScene;window.saveVisionScene=saveVisionScene;window.visionUndo=visionUndo;window.visionRedo=visionRedo;
})();