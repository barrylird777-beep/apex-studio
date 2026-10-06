import {useState} from "react";
import ProjectDashboard from "./pages/ProjectDashboard";
import CharacterDatabase from "./pages/CharacterDatabase";
import ScriptureBreakdown from "./pages/ScriptureBreakdown";
import SceneList from "./pages/SceneList";
import NetworkDashboard from "./pages/NetworkDashboard";

const nav=[
  ["projects","Projects","/"],
  ["characters","Characters","/characters"],
  ["breakdown","Scripture","/breakdown"],
  ["scenes","Scenes","/scenes"],
  ["network","Network","/network"],
] as const;

export default function App(){
  const path=location.pathname;
  const initial=path.startsWith("/characters")?"characters":path.startsWith("/breakdown")?"breakdown":path.startsWith("/scenes")?"scenes":path.startsWith("/network")?"network":"projects";
  const [p,setP]=useState<typeof nav[number][0]>(initial);
  const go=(key:typeof p,url:string)=>{history.pushState(null,"",url);setP(key);};
  const page=p==="characters"?<CharacterDatabase/>:p==="breakdown"?<ScriptureBreakdown/>:p==="scenes"?<SceneList/>:p==="network"?<NetworkDashboard/>:<ProjectDashboard/>;
  return <><div style={{position:"fixed",top:12,right:12,zIndex:1000,display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
    {nav.map(([key,label,url])=><button key={key} onClick={()=>go(key,url)} style={{padding:"8px 12px",borderRadius:8,cursor:"pointer",fontWeight:key===p?700:500}}>{label}</button>)}
  </div>{page}</>;
}