import {useEffect,useRef,useState} from "react";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
type NetworkState={status:string;verified:any;checkedAt:string;selected:any;failover:any[];candidates:any[];peers:any;speed:any;policy:any;planes?:any;error?:string};
type Benchmark={mib:number;bytes:number;elapsedMs:number;mbps:number;startedAt:string;finishedAt:string};
const stateLabel=(s:string)=>s==="connected"?"Connected":s==="degraded"?"Degraded":"Offline";

function BrowserPeerTest(){
  const pc=useRef<RTCPeerConnection|null>(null);
  const channel=useRef<RTCDataChannel|null>(null);
  const [signal,setSignal]=useState("");
  const [connection,setConnection]=useState("Not started");
  const [channelState,setChannelState]=useState("Closed");
  const [pathType,setPathType]=useState("Not measured");
  const [received,setReceived]=useState(0);
  const [sent,setSent]=useState(0);
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState("Opt-in test only. No application traffic is routed over this channel.");
  const attachChannel=(dc:RTCDataChannel)=>{
    channel.current=dc;
    dc.onopen=()=>{setChannelState("Open");setNote("Data channel open. Messages sent here travel browser-to-browser when ICE selects a direct candidate pair.");};
    dc.onclose=()=>setChannelState("Closed");
    dc.onerror=()=>setNote("Data channel error. Check network policy and repeat the handshake.");
    dc.onmessage=(event)=>{setReceived(n=>n+(typeof event.data==="string"?new Blob([event.data]).size:event.data?.byteLength||0));};
  };
  const createPeer=()=>{
    if(pc.current)pc.current.close();
    channel.current=null;
    const peer=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    pc.current=peer;
    peer.onconnectionstatechange=()=>setConnection(peer.connectionState);
    peer.ondatachannel=event=>attachChannel(event.channel);
    peer.oniceconnectionstatechange=()=>{if(peer.iceConnectionState==="failed")setNote("ICE failed. This prototype has no TURN fallback; some NATs/firewalls will block direct connectivity.");};
    return peer;
  };
  const gather=async(peer:RTCPeerConnection)=>{
    if(peer.iceGatheringState==="complete")return;
    await new Promise<void>(resolve=>{
      const timer=window.setTimeout(()=>{peer.removeEventListener("icegatheringstatechange",check);resolve();},8000);
      const check=()=>{if(peer.iceGatheringState==="complete"){window.clearTimeout(timer);peer.removeEventListener("icegatheringstatechange",check);resolve();}};
      peer.addEventListener("icegatheringstatechange",check);
    });
  };
  const makeOffer=async()=>{
    setBusy(true);
    try{
      const peer=createPeer();
      attachChannel(peer.createDataChannel("apex-peer-test",{ordered:true}));
      await peer.setLocalDescription(await peer.createOffer());
      await gather(peer);
      setSignal(JSON.stringify(peer.localDescription));
      setNote("Offer created. Copy it to the other browser, where the receiver pastes it and creates an answer.");
    }catch(e){setNote(e instanceof Error?e.message:"Could not create offer.");}
    finally{setBusy(false);}
  };
  const makeAnswer=async()=>{
    setBusy(true);
    try{
      const offer=JSON.parse(signal);
      if(offer?.type!=="offer"||typeof offer?.sdp!=="string")throw new Error("Paste a valid offer JSON first.");
      const peer=createPeer();
      await peer.setRemoteDescription(offer);
      await peer.setLocalDescription(await peer.createAnswer());
      await gather(peer);
      setSignal(JSON.stringify(peer.localDescription));
      setNote("Answer created. Copy it back to the initiating browser and apply it there.");
    }catch(e){setNote(e instanceof Error?e.message:"Could not create answer.");}
    finally{setBusy(false);}
  };
  const applyAnswer=async()=>{
    try{
      const answer=JSON.parse(signal);
      if(answer?.type!=="answer"||typeof answer?.sdp!=="string")throw new Error("Paste a valid answer JSON first.");
      if(!pc.current?.localDescription||pc.current.localDescription.type!=="offer")throw new Error("Create an offer in this browser first.");
      await pc.current.setRemoteDescription(answer);
      setNote("Answer applied. Waiting for ICE connectivity and the data channel to open.");
    }catch(e){setNote(e instanceof Error?e.message:"Could not apply answer.");}
  };
  const sendProbe=async()=>{
    const dc=channel.current;
    if(!dc||dc.readyState!=="open"){setNote("Connect both browsers before sending a probe.");return;}
    const payload=JSON.stringify({type:"apex-peer-probe",at:Date.now(),nonce:crypto.randomUUID(),bytes:16384,payload:"x".repeat(16384)});
    dc.send(payload);setSent(n=>n+new Blob([payload]).size);
    try{
      const stats=await pc.current?.getStats();
      stats?.forEach((s:any)=>{if(s.type==="candidate-pair"&&s.state==="succeeded"&&s.nominated){const local=stats.get(s.localCandidateId),remote=stats.get(s.remoteCandidateId);setPathType(local?.candidateType==="relay"||remote?.candidateType==="relay"?"Relay candidate":local?.candidateType==="srflx"||remote?.candidateType==="srflx"?"STUN-reflexive candidate pair":"Host candidate pair");}});
      setNote("Probe sent. Byte counters are local measurements; repeat in both directions to verify received bytes.");
    }catch{setNote("Probe sent; candidate-path telemetry was unavailable.");}
  };
  const close=()=>{pc.current?.close();pc.current=null;channel.current=null;setConnection("Closed");setChannelState("Closed");setPathType("Not measured");setNote("Peer connection closed. No background connection remains.");};
  useEffect(()=>()=>{pc.current?.close();},[]);
  return <Card className="mt-6"><CardHeader><CardTitle>Browser-to-browser WebRTC proof</CardTitle></CardHeader><CardContent>
    <p className="text-sm text-muted-foreground">Optional two-browser data-channel test. Signaling is manual copy/paste; a public STUN service helps discover network routes. No media, jobs, or app data are offloaded by this prototype.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Peer connection</div><b>{connection}</b></div><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Data channel</div><b>{channelState}</b></div><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Candidate path</div><b>{pathType}</b></div></div>
    <label className="mt-4 block text-sm font-medium" htmlFor="apex-webrtc-signal">Offer / answer JSON</label>
    <textarea id="apex-webrtc-signal" value={signal} onChange={e=>setSignal(e.target.value)} rows={5} autoCapitalize="off" spellCheck={false} className="mt-2 w-full rounded-lg border bg-background p-3 font-mono text-xs" placeholder="Generate an offer here, or paste the other browser's offer/answer." />
    <div className="mt-3 flex flex-wrap gap-2"><Button onClick={makeOffer} disabled={busy}>Create offer</Button><Button onClick={makeAnswer} disabled={busy}>Create answer from pasted offer</Button><Button onClick={applyAnswer} disabled={busy}>Apply pasted answer</Button><Button onClick={sendProbe} disabled={channelState!=="Open"}>Send 16 KiB probe</Button><Button onClick={close} variant="outline">Disconnect</Button><Button onClick={async()=>{try{await navigator.clipboard.writeText(signal);setNote("Signaling JSON copied.");}catch{setNote("Clipboard unavailable. Select and copy the JSON manually.");}}} variant="outline" disabled={!signal}>Copy JSON</Button></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Bytes sent from this browser</div><b>{sent.toLocaleString()}</b></div><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Bytes received by this browser</div><b>{received.toLocaleString()}</b></div></div>
    <p role="status" className="mt-3 text-sm text-muted-foreground">{note}</p>
    <p className="mt-2 text-xs text-muted-foreground">Security note: WebRTC encrypts data channels at the transport layer. This test does not establish libp2p peer identity, Noise authentication, mesh membership, or a production relay fallback. Never paste signaling JSON from an untrusted party.</p>
  </CardContent></Card>;
}

export default function NetworkDashboard(){const[data,setData]=useState<NetworkState|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState("");const[testing,setTesting]=useState(false);const[progress,setProgress]=useState(0);const[result,setResult]=useState<Benchmark|null>(null);
async function refresh(){try{setLoading(true);const r=await fetch("/api/network/status",{cache:"no-store"});if(!r.ok)throw new Error("Network telemetry unavailable");setData(await r.json());setError("")}catch(e){setError(e instanceof Error?e.message:"Network telemetry unavailable")}finally{setLoading(false)}}
async function runBenchmark(mib:number){if(testing)return;setTesting(true);setProgress(0);setResult(null);setError("");const startedAt=new Date().toISOString();const started=performance.now();try{const r=await fetch("/api/network/throughput?mib="+mib,{cache:"no-store"});if(!r.ok||!r.body)throw new Error("Throughput test unavailable (HTTP "+r.status+")");const total=Number(r.headers.get("x-apex-benchmark-bytes")||mib*1024*1024);const reader=r.body.getReader();let bytes=0;for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value?.byteLength||0;setProgress(Math.min(100,(bytes/total)*100))}const elapsedMs=Math.max(1,performance.now()-started);setResult({mib,bytes,elapsedMs,mbps:(bytes*8)/(elapsedMs/1000)/1e6,startedAt,finishedAt:new Date().toISOString()});setProgress(100)}catch(e){setError(e instanceof Error?e.message:"Throughput test failed")}finally{setTesting(false)}}
useEffect(()=>{refresh();const id=window.setInterval(refresh,10000);return()=>window.clearInterval(id)},[]);
const selected=data?.selected;const peers=typeof data?.peers==="number"?data.peers:(data?.peers?.available===false?"Unavailable":"—");
return <div className="container mx-auto max-w-6xl p-6"><div className="mb-8 flex items-center justify-between"><div><h1 className="text-3xl font-bold tracking-tight">Apex Network</h1><p className="text-muted-foreground">Measured client connectivity</p></div><Button onClick={refresh} disabled={loading}>{loading?"Checking…":"Refresh"}</Button></div>
<Card><CardHeader><div className="flex items-center justify-between"><CardTitle>Connection</CardTitle><Badge>{data?stateLabel(data.status):"Detecting"}</Badge></div></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-4"><div><div className="text-sm text-muted-foreground">Active path</div><b>{selected?.device||"None"}</b></div><div><div className="text-sm text-muted-foreground">Network</div><b>{selected?.network||"—"}</b></div><div><div className="text-sm text-muted-foreground">RTT</div><b>{Number.isFinite(selected?.rttMs)?Math.round(selected.rttMs)+" ms":"—"}</b></div><div><div className="text-sm text-muted-foreground">Peers</div><b>{peers}</b></div></div><div className="mt-6 rounded-lg border p-4"><div className="font-medium">{data?.speed?.mode==="multipath"?"Client multipath verified":data?.status==="connected"?"Single client path":"Network unavailable"}</div><p className="mt-1 text-sm text-muted-foreground">Only client-verified paths are presented as real iPhone network paths. Server runtime interfaces are diagnostic observations.</p><div className="mt-3 flex flex-wrap gap-2"><Badge>{data?.speed?.mode==="multipath"?"Multipath verified":"Multipath not verified"}</Badge><Badge>Failover {data?.failover?.length?"Ready":"Not verified"}</Badge><Badge>Adaptive telemetry</Badge><Badge>{data?.verified?.runtimeInterfacesObserved?"Server runtime observed":"Client telemetry"}</Badge></div></div>{error&&<p className="mt-4 text-sm text-destructive">{error}</p>}<p className="mt-4 text-xs text-muted-foreground">Last check: {data?.checkedAt?new Date(data.checkedAt).toLocaleString():"—"}</p></CardContent></Card>
<Card className="mt-6"><CardHeader><CardTitle>Real throughput test</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Downloads a controlled payload from the live Apex deployment and measures the client-to-Apex transfer rate.</p><div className="mt-4 flex flex-wrap gap-3"><Button onClick={()=>runBenchmark(32)} disabled={testing}>Test 32 MiB</Button><Button onClick={()=>runBenchmark(64)} disabled={testing}>Test 64 MiB</Button></div>{testing&&<div className="mt-4"><div className="mb-2 flex justify-between text-sm"><span>Downloading…</span><span>{progress.toFixed(0)}%</span></div><div className="h-3 overflow-hidden rounded-full border"><div className="h-full transition-all" style={{width:progress+"%"}} /></div></div>}{result&&<div className="mt-4 grid gap-4 rounded-lg border p-4 md:grid-cols-4"><div><div className="text-sm text-muted-foreground">Throughput</div><b className="text-2xl">{result.mbps.toFixed(2)} Mbps</b></div><div><div className="text-sm text-muted-foreground">Payload</div><b>{(result.bytes/1024/1024).toFixed(1)} MiB</b></div><div><div className="text-sm text-muted-foreground">Elapsed</div><b>{(result.elapsedMs/1000).toFixed(2)} s</b></div><div><div className="text-sm text-muted-foreground">Status</div><Badge>Measured</Badge></div></div>}</CardContent></Card>
<BrowserPeerTest/><Card className="mt-6"><CardHeader><CardTitle>Available paths</CardTitle></CardHeader><CardContent>{data?.candidates?.length?<div className="space-y-2">{data.candidates.map((p:any)=><div key={p.device} className="flex items-center justify-between rounded-md border p-3"><div><b>{p.device}</b><span className="ml-2 text-sm text-muted-foreground">{p.network}</span></div><div className="text-sm">{p.healthy?"Healthy":"Unavailable"} · {Number.isFinite(p.rttMs)?Math.round(p.rttMs)+" ms":"—"}</div></div>)}</div>:<p className="text-sm text-muted-foreground">No network interfaces are currently confirmed healthy.</p>}</CardContent></Card></div>}