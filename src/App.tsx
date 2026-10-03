import {useState} from "react";
import ProjectDashboard from "./pages/ProjectDashboard";
import CharacterDatabase from "./pages/CharacterDatabase";
import ScriptureBreakdown from "./pages/ScriptureBreakdown";
import SceneList from "./pages/SceneList";
export default function App(){
  const path=location.pathname;
  const [p,setP]=useState(path.startsWith("/characters")?"characters":path.startsWith("/breakdown")?"breakdown":path.startsWith("/scenes")?"scenes":"projects");
  if(p==="characters")return <CharacterDatabase/>;
  if(p==="breakdown")return <ScriptureBreakdown/>;
  if(p==="scenes")return <SceneList/>;
  return <><ProjectDashboard/><button className="floating-nav" onClick={()=>{history.pushState(null,"","/characters");setP("characters")}}>Characters</button><button className="floating-nav" style={{right:140}} onClick={()=>{history.pushState(null,"","/breakdown");setP("breakdown")}}>Scripture</button></>;
}