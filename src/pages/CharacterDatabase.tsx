import {FormEvent,useEffect,useState} from "react";
type Relationship={name:string;relation:string};
type Character={id:number;canonicalName:string;aliases:string[];primaryStories:string[];relationships:Relationship[];keyTraits:string[];notes:string|null;scriptureReferences:string[]};
type Draft=Omit<Character,"id">;
const empty:Draft={canonicalName:"",aliases:[],primaryStories:[],relationships:[],keyTraits:[],notes:"",scriptureReferences:[]};
const list=(s:string)=>s.split(/\n|,/).map(x=>x.trim()).filter(Boolean);
const rels=(s:string)=>s.split("\n").map(x=>x.trim()).filter(Boolean).map(x=>{const [name,...r]=x.split("|");return{name:name.trim(),relation:r.join("|").trim()}}).filter(x=>x.name&&x.relation);
const draft=(c:Character):Draft=>({...c,aliases:[...c.aliases],primaryStories:[...c.primaryStories],relationships:c.relationships.map(x=>({...x})),keyTraits:[...c.keyTraits],scriptureReferences:[...c.scriptureReferences],notes:c.notes||""});
export default function CharacterDatabase(){
 const [rows,setRows]=useState<Character[]>([]),[q,setQ]=useState(""),[selected,setSelected]=useState<Character|null>(null),[form,setForm]=useState<Draft>(empty),[editing,setEditing]=useState(false),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const load=async()=>{try{const r=await fetch("/api/characters?q="+encodeURIComponent(q));if(!r.ok)throw Error("Unable to load characters");setRows(await r.json());}catch(e){setError(e instanceof Error?e.message:"Unable to load characters")}};
 useEffect(()=>{load()},[q]);
 const open=(c:Character)=>{setSelected(c);setForm(draft(c));setEditing(false);setCreating(false);setError("")};
 const create=()=>{setSelected(null);setForm(empty);setEditing(true);setCreating(true);setError("")};
 const save=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError("");try{const r=await fetch(creating?"/api/characters":"/api/characters/"+selected!.id,{method:creating?"POST":"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(form)});const data=await r.json();if(!r.ok)throw Error(data.error||"Unable to save character");await load();open(data)}catch(e){setError(e instanceof Error?e.message:"Unable to save character")}finally{setBusy(false)}};
 const remove=async()=>{if(!selected||!confirm("Delete "+selected.canonicalName+"?"))return;setBusy(true);try{const r=await fetch("/api/characters/"+selected.id,{method:"DELETE"});if(!r.ok)throw Error("Unable to delete character");setSelected(null);setEditing(false);await load()}catch(e){setError(e instanceof Error?e.message:"Unable to delete character")}finally{setBusy(false)}};
 const setList=(k:keyof Pick<Draft,"aliases"|"primaryStories"|"keyTraits"|"scriptureReferences">,v:string)=>setForm(x=>({...x,[k]:list(v)}));
 return <><header><div className="brand"><div className="mark">A</div><div><b>APEX STUDIO</b><small>Production workspace</small></div></div><button onClick={()=>location.href="/"}>Projects</button></header><main>
 <div className="heading"><small>CHARACTER DATABASE</small><h1>Biblical Characters</h1><p>Search and maintain character continuity across Bible stories.</p></div>
 <div className="character-toolbar"><input aria-label="Search characters" placeholder="Search by name, alias, or story" value={q} onChange={e=>setQ(e.target.value)}/><button onClick={create}>New character</button></div>
 {error&&<div className="error alert">{error}</div>}
 {!rows.length&&!q?<div className="empty"><h2>No characters yet</h2><p>Add a character or run the database seed to populate the database.</p><button onClick={create}>Create first character</button></div>:
 <div className="character-grid"><section className="list"><div className="count">{rows.length} character{rows.length===1?"":"s"}</div>{rows.map(c=><button className={"row "+(selected?.id===c.id?"active":"")} key={c.id} onClick={()=>open(c)}><span><b>{c.canonicalName}</b><small>{c.primaryStories.join(" · ")||"No stories listed"}</small></span></button>)}</section>
 <section className="detail">{creating||selected?<form onSubmit={save}><div className="detailhead"><div><small>{creating?"NEW CHARACTER":"CHARACTER DETAIL"}</small><h2>{creating?"Create character":selected?.canonicalName}</h2></div><div className="actions">{!creating&&<><button type="button" onClick={()=>setEditing(!editing)}>{editing?"Cancel":"Edit"}</button><button type="button" onClick={remove} disabled={busy}>Delete</button></>}</div></div>
 {editing?<div className="character-form">
 <label>Canonical name<input required value={form.canonicalName} onChange={e=>setForm({...form,canonicalName:e.target.value})}/></label>
 <label>Aliases<textarea value={form.aliases.join("\n")} onChange={e=>setList("aliases",e.target.value)}/></label>
 <label>Primary stories<textarea value={form.primaryStories.join("\n")} onChange={e=>setList("primaryStories",e.target.value)}/></label>
 <label>Relationships<textarea value={form.relationships.map(x=>x.name+" | "+x.relation).join("\n")} onChange={e=>setForm({...form,relationships:rels(e.target.value)})}/></label>
 <label>Key traits<textarea value={form.keyTraits.join("\n")} onChange={e=>setList("keyTraits",e.target.value)}/></label>
 <label>Notes<textarea value={form.notes||""} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
 <label>Scripture references<textarea value={form.scriptureReferences.join("\n")} onChange={e=>setList("scriptureReferences",e.target.value)}/></label>
 <div className="actions form-actions"><button type="submit" disabled={busy}>{busy?"Saving…":creating?"Create character":"Save changes"}</button></div></div>:
 <div className="character-fields">{[["Aliases",selected?.aliases.join(", ")],["Primary stories",selected?.primaryStories.join(" · ")],["Relationships",selected?.relationships.map(x=>x.name+" — "+x.relation).join(" · ")],["Key traits",selected?.keyTraits.join(" · ")],["Notes",selected?.notes||"—"],["Scripture references",selected?.scriptureReferences.join(" · ")]].map(([k,v])=><div className="field" key={k}><b>{k}</b><p>{v||"—"}</p></div>)}</div>}</form>:<div className="select"><h2>Select a character</h2><p>Choose a character to view all fields.</p></div>}</section></div>}</main></>}