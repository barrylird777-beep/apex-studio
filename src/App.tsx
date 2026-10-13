import {useEffect,useState} from "react";
import ProjectDashboard from "./pages/ProjectDashboard";
import CharacterDatabase from "./pages/CharacterDatabase";
import ScriptureBreakdown from "./pages/ScriptureBreakdown";
import SceneList from "./pages/SceneList";
import NetworkDashboard from "./pages/NetworkDashboard";
import LocalAI from "./pages/LocalAI";
import SixAppHub from "./pages/SixAppHub";

const nav=[
  ["apps","APEX Apps","/apps"],
  ["projects","Projects","/"],
  ["characters","Characters","/characters"],
  ["breakdown","Scripture","/breakdown"],
  ["scenes","Scenes","/scenes"],
  ["network","Network","/network"],
  ["localai","Local AI","/local-ai"],
] as const;

function pageForPath(path:string):typeof nav[number][0]{
  if(path.startsWith("/apps"))return "apps";
  if(path.startsWith("/local-ai"))return "localai";
  if(path.startsWith("/characters"))return "characters";
  if(path.startsWith("/breakdown"))return "breakdown";
  if(path.startsWith("/scenes"))return "scenes";
  if(path.startsWith("/network"))return "network";
  return "projects";
}
export default function App(){
  const [p,setP]=useState<typeof nav[number][0]>(()=>pageForPath(location.pathname));
  useEffect(()=>{
    const syncFromHistory=()=>setP(pageForPath(location.pathname));
    window.addEventListener("popstate",syncFromHistory);
    return ()=>window.removeEventListener("popstate",syncFromHistory);
  },[]);
  const go=(key:typeof p,url:string)=>{if(location.pathname!==url)history.pushState(null,"",url);setP(key);};
  const page=p==="apps"?<SixAppHub/>:p==="localai"?<LocalAI/>:p==="characters"?<CharacterDatabase/>:p==="breakdown"?<ScriptureBreakdown/>:p==="scenes"?<SceneList/>:p==="network"?<NetworkDashboard/>:<ProjectDashboard/>;
  return <><nav className="apex-nav" aria-label="Apex Studio navigation">
    {nav.map(([key,label,url])=><button key={key} onClick={()=>go(key,url)} aria-current={key===p?"page":undefined} style={{padding:"8px 12px",borderRadius:8,cursor:"pointer",fontWeight:key===p?700:500,whiteSpace:"nowrap"}}>{label}</button>)}
  </nav>{page}</>;
}