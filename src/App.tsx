import {useEffect, useState, type FormEvent} from "react";
import ProjectDashboard from "./pages/ProjectDashboard";
import CharacterDatabase from "./pages/CharacterDatabase";
import ScriptureBreakdown from "./pages/ScriptureBreakdown";
import SceneList from "./pages/SceneList";
import NetworkDashboard from "./pages/NetworkDashboard";
import LocalAI from "./pages/LocalAI";

const nav=[
  ["projects","Projects","/"],
  ["characters","Characters","/characters"],
  ["breakdown","Scripture","/breakdown"],
  ["scenes","Scenes","/scenes"],
  ["network","Network","/network"],
  ["localai","Local AI","/local-ai"],
] as const;

type SessionStatus = { configured?: boolean; authenticated?: boolean; authority?: string | null };

export default function App(){
  const path=location.pathname;
  const initial=path.startsWith("/local-ai")?"localai":path.startsWith("/characters")?"characters":path.startsWith("/breakdown")?"breakdown":path.startsWith("/scenes")?"scenes":path.startsWith("/network")?"network":"projects";
  const [p,setP]=useState<typeof nav[number][0]>(initial);
  const [authReady,setAuthReady]=useState(false);
  const [configured,setConfigured]=useState<boolean | null>(null);
  const [authenticated,setAuthenticated]=useState(false);
  const [password,setPassword]=useState("");
  const [authError,setAuthError]=useState("");
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    let active=true;
    fetch("/api/auth/session",{cache:"no-store"})
      .then(async response=>{
        const data:SessionStatus=await response.json();
        if(!response.ok) throw new Error("The sign-in service could not be checked.");
        if(active){
          setConfigured(Boolean(data.configured));
          setAuthenticated(Boolean(data.authenticated));
        }
      })
      .catch(()=>{if(active)setAuthError("Could not reach the sign-in service. Check your connection and try again.");})
      .finally(()=>{if(active)setAuthReady(true);});
    return ()=>{active=false;};
  },[]);

  const go=(key:typeof p,url:string)=>{history.pushState(null,"",url);setP(key);};
  async function signIn(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setBusy(true);setAuthError("");
    try{
      const response=await fetch("/api/auth/sign-in",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({password}),
        cache:"no-store"
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Sign-in failed.");
      setAuthenticated(true);setConfigured(true);setPassword("");
    }catch(error){
      setAuthError(error instanceof Error?error.message:"Sign-in failed. Try again.");
    }finally{setBusy(false);}
  }
  async function signOut(){
    setBusy(true);
    try{await fetch("/api/auth/sign-out",{method:"POST",cache:"no-store"});}
    finally{setAuthenticated(false);setPassword("");setBusy(false);}
  }

  if(!authReady)return <main className="owner-gate"><section className="owner-card"><div className="owner-mark">A</div><p className="owner-eyebrow">APEX · PRIVATE SYSTEM</p><h1>Checking your sign-in</h1><p className="owner-muted">Securing your owner session…</p></section></main>;

  if(configured===false)return <main className="owner-gate"><section className="owner-card"><div className="owner-mark">A</div><p className="owner-eyebrow">APEX · OWNER ACCESS</p><h1>One authority. One sign-in.</h1><p className="owner-muted">The owner sign-in code is ready, but the deployment still needs its private passphrase.</p><div className="owner-notice">Set <code>APEX_OWNER_PASSWORD</code> in the deployment’s private environment settings. Use a unique secret with at least 24 characters. Never put it in source code.</div></section></main>;

  if(!authenticated)return <main className="owner-gate"><section className="owner-card"><div className="owner-mark">A</div><p className="owner-eyebrow">APEX · OWNER ACCESS</p><h1>Welcome back.</h1><p className="owner-muted">Private access for the system’s single owner.</p><form className="owner-form" onSubmit={signIn}><label htmlFor="owner-password">Owner passphrase</label><input id="owner-password" type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required minLength={24} autoFocus/><button className="owner-submit" type="submit" disabled={busy||password.length<24}>{busy?"Checking…":"Sign in securely"}</button><p className="owner-error" role="alert">{authError}</p></form><p className="owner-footnote">Your passphrase is checked by the server. The session is held in an HttpOnly cookie—not browser storage.</p></section></main>;

  const page=p==="localai"?<LocalAI/>:p==="characters"?<CharacterDatabase/>:p==="breakdown"?<ScriptureBreakdown/>:p==="scenes"?<SceneList/>:p==="network"?<NetworkDashboard/>:<ProjectDashboard/>;
  return <><nav className="apex-nav" aria-label="Apex Studio navigation">
    {nav.map(([key,label,url])=><button key={key} onClick={()=>go(key,url)} aria-current={key===p?"page":undefined} style={{padding:"8px 12px",borderRadius:8,cursor:"pointer",fontWeight:key===p?700:500,whiteSpace:"nowrap"}}>{label}</button>)}
    <button className="owner-signout" onClick={signOut} disabled={busy}>{busy?"Signing out…":"Sign out"}</button>
  </nav>{page}</>;
}
