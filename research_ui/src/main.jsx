import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import "./style.css";
const API=import.meta.env.VITE_RESEARCH_API||"http://localhost:8000/api";
function App(){
 const [dashboard,setDashboard]=useState({}); const [requests,setRequests]=useState([]); const [investigations,setInvestigations]=useState([]); const [docs,setDocs]=useState([]); const [q,setQ]=useState("");
 async function load(){const h=await fetch(API+"/dashboard");setDashboard(await h.json());setRequests(await (await fetch(API+"/requests")).json());setInvestigations(await (await fetch(API+"/investigations")).json());setDocs(await (await fetch(API+"/documents")).json())}
 useEffect(()=>{load()},[]);
 return <main><header><div><small>APEX RESEARCH</small><h1>Research & FOIA Workspace</h1></div><button onClick={load}>Refresh</button></header>
 <section className="cards">{Object.entries(dashboard).map(([k,v])=><article key={k}><strong>{v??0}</strong><span>{k.replaceAll("_"," ")}</span></article>)}</section>
 <section className="toolbar"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search documents, agencies, investigations"/><button>Search</button></section>
 <div className="grid"><section><h2>FOIA requests</h2>{requests.map(r=><div className="row" key={r.id}><b>{r.tracking_number||"Unassigned"}</b><span>{r.status}</span><time>{r.date_due?new Date(r.date_due).toLocaleDateString():"No due date"}</time></div>)}</section>
 <section><h2>Investigations</h2>{investigations.map(x=><div className="row" key={x.id}><b>{x.title}</b><span>{x.status}</span></div>)}</section>
 <section><h2>Documents</h2>{docs.map(d=><div className="row" key={d.id}><b>Document {d.id}</b><span>{d.classification_level}</span><span>{d.redaction_count} redactions</span></div>)}</section></div>
 </main>
}
createRoot(document.getElementById("root")).render(<App/>);