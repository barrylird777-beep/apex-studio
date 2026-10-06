import {useState} from "react";
import ProjectDashboard from "./pages/ProjectDashboard";
import CharacterDatabase from "./pages/CharacterDatabase";
import ScriptureBreakdown from "./pages/ScriptureBreakdown";
import SceneList from "./pages/SceneList";
import NetworkDashboard from "./pages/NetworkDashboard";
export default function App(){const path=location.pathname;const [p,setP]=useState(path.startsWith("/characters")?"characters":path.startsWith("/breakdown")?"breakdown":path.startsWith("/scenes")?"scenes":path.startsWith("/network")?"network":"projects");if(p==="characters")return <CharacterDatabase/>;if(p==="breakdown")return <ScriptureBreakdown/>;if(p==="scenes")return <SceneList/>;if(p==="network")return <NetworkDashboard/>;return <><ProjectDashboard/><button className="floating-nav" onClick={()=>{history.pushState(null,"","/characters");setP("characters")}}>Characters</button><button className="floating-nav" style={{right:140}} onClick={()=>{history.pushState(null,"","/breakdown");setP("breakdown")}}>Scripture</button><button className="floating-nav" style={{right:280}} onClick={()=>{history.pushState(null,"","/network");setP("network")}}>Network</button></>}