import {FormEvent,useEffect,useState} from "react";

type Relationship={name:string;relation:string};
type Character={id:number;canonicalName:string;aliases:string[];primaryStories:string[];relationships:Relationship[];keyTraits:string[];notes:string|null;scriptureReferences:string[]};
type Draft=Omit<Character,"id">;

const emptyDraft:Draft={canonicalName:"",aliases:[],primaryStories:[],relationships:[],keyTraits:[],notes:"",scriptureReferences:[]};
const lines=(xs:string[])=>xs.join("\n");
const parseLines=(value:string)=>value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);
const parseRelationships=(value:string)=>value.split("\n").map(x=>x.trim()).filter(Boolean).map(x=>{const [name,...rest]=x.split("|");return {name:name.trim(),relation:rest.join("|").trim()};}).filter(x=>x.name&&x.relation);

function toDraft(c:Character):Draft{return {...c,aliases:[...c.aliases],primaryStories:[...c.primaryStories],relationships:c.relationships.map(x=>({...x})),keyTraits:[...c.keyTraits],scriptureReferences:[...c.scriptureReferences],notes:c.notes??""};}
function toPayload(d:Draft){return {...d,aliases:d.aliases,primaryStories:d.primaryStories,relationships:d.relationships,keyTraits:d.keyTraits,notes:d.notes||undefined,scriptureReferences:d.scriptureReferences};}

export default function CharacterDatabase(){
  const [rows,setRows]=useState<Character[]>([]);
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<Character|null>(null);
  const [draft,setDraft]=useState<Draft>(emptyDraft);
  const [editing,setEditing]=useState(false);
  const [creating,setCreating]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const load=async()=>{
    try{const r=await fetch("/api/characters?q="+encodeURIComponent(query));if(!r.ok)throw new Error("Unable to load characters");setRows(await r.json());setError("");}
    catch(e){setError(e instanceof Error?e.message:"Unable to load characters");}
  };
  useEffect(()=>{load();},[query]);
  const open=(c:Character)=>{setSelected(c);setDraft(toDraft(c));setEditing(false);setCreating(false);setError("");};
  const startCreate=()=>{setSelected(null);setDraft(emptyDraft);setEditing(true);setCreating(true);setError("");};
  const save=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setError("");
    try{
      const url=creating?"/api/characters":"/api/characters/"+selected!.id;
      const r=await fetch(url,{method:creating?"POST":"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(toPayload(draft))});
      const data=await r.json();if(!r.ok)throw new Error(data.error||"Unable to save character");
      await load();setSelected(data);setDraft(toDraft(data));setEditing(false);setCreating(false);
    }catch(e){setError(e instanceof Error?e.message:"Unable to save character");}finally{setBusy(false);}
  };
  const remove=async()=>{
    if(!selected||!confirm(`Delete ${selected.canonicalName}?`))return;
    setBusy(true);setError("");
    try{const r=await fetch("/api/characters/"+selected.id,{method:"DELETE"});if(!r.ok)throw new Error("Unable to delete character");setSelected(null);setEditing(false);await load();}
    catch(e){setError(e instanceof Error?e.message:"Unable to delete character");}finally{setBusy(false);}
  };
  const updateList=(key:"aliases"|"primaryStories"|"keyTraits"|"scriptureReferences",value:string)=>setDraft(d=>({...d,[key]:parseLines(value)}));
  return <><header><div className="brand"><div className="mark">A</div><div><b>APEX STUDIO</b><small>Production workspace</small></div></div><button onClick={()=>location.href="/"}>Projects</button></header>
    <main><div className="heading"><small>CHARACTER DATABASE</small><h1>Biblical Characters</h1><p>Search and maintain character continuity across Bible stories.</p></div>
      <div className="character-toolbar"><input aria-label="Search characters" placeholder="Search by name, alias, or story" value={query} onChange={e=>setQuery(e.target.value)}/><button onClick={startCreate}>New character</button></div>
      {error&&<div className="error alert">{error}</div>}
      {!rows.length&&!query?<div className="empty"><div className="emptyicon">✦</div><h2>No characters yet</h2><p>Add a character or run the database seed to populate the biblical character database.</p><button onClick={startCreate}>Create first character</button></div>:
      <div className="character-grid"><section className="list"><div className="count">{rows.length} character{rows.length===1?"":"s"}</div>{rows.map(c=><button className={"row "+(selected?.id===c.id?"active":"")} key={c.id} onClick={()=>open(c)}><span><b>{c.canonicalName}</b><small>{c.primaryStories.join(" · ")||"No stories listed"}</small></span><span className="s">{c.keyTraits[0]||"Character"}</span></button>)}</section>
        <section className="detail">{creating||selected?<form onSubmit={save}>
          <div className="detailhead"><div><small>{creating?"NEW CHARACTER":"CHARACTER DETAIL"}</small><h2>{creating?"Create character":selected?.canonicalName}</h2></div><div className="actions">{!creating&&<button type="button" onClick={()=>setEditing(!editing)}>{editing?"Cancel":"Edit"}</button>}{!creating&&<button type="button" onClick={remove} disabled={busy}>Delete</button>}</div></div>
          {editing?<div className="character-form">
            <label>Canonical name<input required value={draft.canonicalName} onChange={e=>setDraft({...draft,canonicalName:e.target.value})}/></label>
            <label>Aliases<textarea value={lines(draft.aliases)} onChange={e=>updateList("aliases",e.target.value)} placeholder="One per line"/></label>
            <label>Primary stories<textarea value={lines(draft.primaryStories)} onChange={e=>updateList("primaryStories",e.target.value)} placeholder="Genesis&#10;Exodus"/></label>
            <label>Relationships<textarea value={draft.relationships.map(x=>`${x.name} | ${x.relation}`).join("\n")} onChange={e=>setDraft({...draft,relationships:parseRelationships(e.target.value)})} placeholder="Moses | Brother"/></label>
            <label>Key traits<textarea value={lines(draft.keyTraits)} onChange={e=>updateList("keyTraits",e.target.value)} placeholder="Faithful&#10;Leader"/></label>
            <label>Notes<textarea value={draft.notes||""} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
            <label>Scripture references<textarea value={lines(draft.scriptureReferences)} onChange={e=>updateList("scriptureReferences",e.target.value)} placeholder="Genesis 12:1"/></label>
            <div className="actions form-actions"><button type="submit" disabled={busy}>{busy?"Saving…":creating?"Create character":"Save changes"}</button></div>
          </div>:
          <div className="character-fields">{[["Aliases",selected?.aliases.join(", ")],["Primary stories",selected?.primaryStories.join(" · ")],["Relationships",selected?.relationships.map(x=>x.name+" — "+x.relation).join(" · ")],["Key traits",selected?.keyTraits.join(" · ")],["Notes",selected?.notes||"—"],["Scripture references",selected?.scriptureReferences.join(" · ")]].map(([k,v])=><div className="field" key={k as string}><b>{k}</b><p>{v||"—"}</p></div>)}</div>}
        </form>:<div className="select"><h2>Select a character</h2><p>Choose a character to view all fields, edit it, or delete it.</p></div>}</section>
      </div>}
    </main></>;
}
