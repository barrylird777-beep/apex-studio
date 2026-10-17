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
  const [transferRate,setTransferRate]=useState("Not measured");
  const [transferStatus,setTransferStatus]=useState("No transfer run");
  const [checksumStatus,setChecksumStatus]=useState("Not verified");
  const [senderSha256,setSenderSha256]=useState("");
  const [receiverSha256,setReceiverSha256]=useState("");
  const [bufferedAmount,setBufferedAmount]=useState(0);
  const incomingTransfers=useRef(new Map<string,{chunks:Map<number,Uint8Array>;totalChunks:number;expectedSha256:string;payloadBytes:number}>());
  const [note,setNote]=useState("Opt-in test only. No application traffic is routed over this channel.");
  const attachChannel=(dc:RTCDataChannel)=>{
    channel.current=dc;
    dc.onopen=()=>{setChannelState("Open");setNote("Data channel open. Messages sent here travel browser-to-browser when ICE selects a direct candidate pair.");};
    dc.onclose=()=>setChannelState("Closed");
    dc.onerror=()=>setNote("Data channel error. Check network policy and repeat the handshake.");
    dc.onmessage=async(event)=>{
      if(typeof event.data!=="string"){setNote("Unexpected binary message ignored; test frames use validated metadata.");return;}
      try{
        const packet=JSON.parse(event.data);
        if(packet?.type==="apex-webrtc-benchmark-result")return;
        if(packet?.type!=="apex-webrtc-benchmark"||typeof packet.transferId!=="string"||typeof packet.payload!=="string")return;
        const transfer=incomingTransfers.current.get(packet.transferId)??{chunks:new Map<number,Uint8Array>(),totalChunks:packet.totalChunks,expectedSha256:packet.expectedSha256,payloadBytes:0};
        if(!Number.isInteger(packet.index)||packet.totalChunks!==32||packet.index<0||packet.index>=32||transfer.totalChunks!==32||typeof packet.expectedSha256!=="string"||!/^[a-f0-9]{64}$/.test(packet.expectedSha256)||transfer.expectedSha256!==packet.expectedSha256){setChecksumStatus("Invalid transfer metadata");return;}
        let bytes:Uint8Array;
        try{bytes=Uint8Array.from(atob(packet.payload),ch=>ch.charCodeAt(0));}catch{setChecksumStatus("FAIL — malformed base64 chunk");return;}
        if(bytes.byteLength!==32*1024||transfer.payloadBytes+bytes.byteLength>1024*1024){setChecksumStatus("FAIL — invalid chunk size or payload limit");return;}
        if(!transfer.chunks.has(packet.index)){transfer.chunks.set(packet.index,bytes);transfer.payloadBytes+=bytes.byteLength;setReceived(transfer.payloadBytes);}
        incomingTransfers.current.set(packet.transferId,transfer);
        if(transfer.chunks.size!==transfer.totalChunks)return;
        const payload=new Uint8Array(transfer.payloadBytes);let offset=0;
        for(let i=0;i<transfer.totalChunks;i++){const part=transfer.chunks.get(i);if(!part){setChecksumStatus("FAIL — missing chunk");return;}payload.set(part,offset);offset+=part.byteLength;}
        const digest=await crypto.subtle.digest("SHA-256",payload);
        const actualSha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
        const verified=actualSha256===transfer.expectedSha256&&transfer.payloadBytes===1024*1024;
        setReceiverSha256(actualSha256);
        setChecksumStatus(verified?"PASS — 1 MiB SHA-256 matches":"FAIL — payload/checksum mismatch");
        setTransferStatus(verified?"Receiver verified all 32 chunks and SHA-256.":"Receiver checksum or payload length mismatch.");
        if(dc.readyState==="open")dc.send(JSON.stringify({type:"apex-webrtc-benchmark-result",transferId:packet.transferId,ok:verified,expectedSha256:transfer.expectedSha256,actualSha256,payloadBytes:transfer.payloadBytes}));
        incomingTransfers.current.delete(packet.transferId);
      }catch{setChecksumStatus("Could not validate received payload");}
    };
  };
  const createPeer=()=>{
    if(pc.current)pc.current.close();
    channel.current=null;
    const peer=new RTCPeerConnection({iceServers:[]});
    pc.current=peer;
    peer.onconnectionstatechange=()=>setConnection(peer.connectionState);
    peer.ondatachannel=event=>attachChannel(event.channel);
    peer.oniceconnectionstatechange=()=>{if(peer.iceConnectionState==="failed")setNote("ICE failed. Public STUN/TURN is disabled; direct host-candidate connectivity can fail behind NATs/firewalls.");};
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
  const runTransfer=async()=>{
    const dc=channel.current;
    if(!dc||dc.readyState!=="open"){setNote("Connect both browsers before running a transfer.");return;}
    setBusy(true);setTransferStatus("Sending test payload…");setTransferRate("Measuring…");setSent(0);
    const totalBytes=1024*1024;
    const chunkBytes=32*1024;
    const totalChunks=totalBytes/chunkBytes;
    const payload=new Uint8Array(totalBytes);
    for(let i=0;i<totalBytes;i++)payload[i]=i%251;
    const transferId=crypto.randomUUID();
    const started=performance.now();
    let sentBytes=0;
    setChecksumStatus("Waiting for receiver checksum…");
    let receiptListener:((event:MessageEvent)=>void)|undefined;
    let receiptTimeout:number|undefined;
    try{
      const expectedSha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",payload)),b=>b.toString(16).padStart(2,"0")).join("");
      setSenderSha256(expectedSha256);setReceiverSha256("");
      setNote("Sender baseline payload: "+payload.byteLength.toLocaleString()+" bytes; SHA-256 "+expectedSha256);
      const receiptPromise=new Promise<{ok:boolean;expectedSha256:string;actualSha256:string;payloadBytes:number}>((resolve,reject)=>{
        let settled=false;
        const finish=(error:Error|undefined,value?:{ok:boolean;expectedSha256:string;actualSha256:string;payloadBytes:number})=>{if(settled)return;settled=true;if(receiptTimeout!==undefined)window.clearTimeout(receiptTimeout);if(receiptListener)dc.removeEventListener("message",receiptListener);if(error)reject(error);else resolve(value!);};
        receiptListener=(event:MessageEvent)=>{if(typeof event.data!=="string")return;try{const receipt=JSON.parse(event.data);if(receipt?.type!=="apex-webrtc-benchmark-result"||receipt.transferId!==transferId)return;finish(undefined,receipt);}catch{}};
        dc.addEventListener("message",receiptListener);
        receiptTimeout=window.setTimeout(()=>finish(new Error("Timed out waiting for explicit receiver SHA-256 receipt.")),15000);
      });
      dc.bufferedAmountLowThreshold=65536;
      const waitForBufferLow=()=>new Promise<void>((resolve,reject)=>{
        let settled=false;
        const cleanup=()=>{window.clearTimeout(timeout);dc.removeEventListener("bufferedamountlow",onLow);};
        const timeout=window.setTimeout(()=>{if(settled)return;settled=true;cleanup();reject(new Error("Timed out waiting for WebRTC send-buffer backpressure."));},10000);
        const onLow=()=>{setBufferedAmount(dc.bufferedAmount);if(settled||dc.bufferedAmount>dc.bufferedAmountLowThreshold)return;settled=true;cleanup();resolve();};
        dc.addEventListener("bufferedamountlow",onLow);
        // Recheck after listener registration to avoid missing a threshold crossing.
        onLow();
      });
      for(let offset=0;offset<totalBytes;offset+=chunkBytes){
        const part=payload.subarray(offset,Math.min(offset+chunkBytes,totalBytes));
        let binary="";for(let i=0;i<part.length;i++)binary+=String.fromCharCode(part[i]);
        const encoded=btoa(binary);
        const packet=JSON.stringify({type:"apex-webrtc-benchmark",transferId,index:offset/chunkBytes,totalChunks,expectedSha256,payload:encoded});
        if(dc.bufferedAmount>256*1024)await waitForBufferLow();
        if(dc.readyState!=="open")throw new Error("WebRTC data channel closed during transfer.");
        dc.send(packet);
        sentBytes+=part.byteLength;
        setSent(n=>n+part.byteLength);
        setBufferedAmount(dc.bufferedAmount);
      }
      if(dc.bufferedAmount>dc.bufferedAmountLowThreshold)await waitForBufferLow();
      const seconds=Math.max((performance.now()-started)/1000,0.001);
      setTransferRate((sentBytes/seconds/1024/1024).toFixed(2)+" MiB/s payload submitted");
      setTransferStatus("Submitted "+sentBytes.toLocaleString()+" payload bytes in "+totalChunks+" chunks; awaiting explicit receiver receipt.");
      const receipt=await receiptPromise;
      const verified=receipt.ok===true&&receipt.expectedSha256===expectedSha256&&receipt.actualSha256===expectedSha256&&receipt.payloadBytes===totalBytes;
      setReceiverSha256(receipt.actualSha256||"");
      setChecksumStatus(verified?"PASS — receiver acknowledged matching SHA-256":"FAIL — receiver receipt mismatch");
      setTransferStatus(verified?"VERIFIED by receiver: 1 MiB, 32 × 32 KiB chunks, SHA-256 matches.":"FAILED — receiver receipt did not match sender payload.");
      setNote("Sender and receiver SHA-256 "+(verified?"match":"do not match")+". Sender queue drain is not delivery proof.");
      if(!verified)throw new Error("Receiver receipt did not validate against sender payload.");
    }catch(e){
      setTransferStatus("Transfer incomplete");
      setNote(e instanceof Error?e.message:"WebRTC transfer failed.");
    }finally{if(receiptTimeout!==undefined)window.clearTimeout(receiptTimeout);if(receiptListener)dc.removeEventListener("message",receiptListener);setBusy(false);}
  };
  const close=()=>{pc.current?.close();pc.current=null;channel.current=null;setConnection("Closed");setChannelState("Closed");setPathType("Not measured");setNote("Peer connection closed. No background connection remains.");};
  useEffect(()=>{const id=window.setInterval(()=>setBufferedAmount(channel.current?.bufferedAmount??0),150);return()=>{window.clearInterval(id);pc.current?.close();};},[]);
  return <Card className="mt-6"><CardHeader><CardTitle>Browser-to-browser WebRTC proof</CardTitle></CardHeader><CardContent>
    <p className="text-sm text-muted-foreground">Direct-only two-browser data-channel test: no public STUN/TURN servers, manual copy/paste signaling, and a 1 MiB synthetic transfer. No media, jobs, files, or app data are routed through this prototype.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Peer connection</div><b>{connection}</b></div><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Data channel</div><b>{channelState}</b></div><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Candidate path</div><b>{pathType}</b></div></div>
    <label className="mt-4 block text-sm font-medium" htmlFor="apex-webrtc-signal">Offer / answer JSON</label>
    <textarea id="apex-webrtc-signal" value={signal} onChange={e=>setSignal(e.target.value)} rows={5} autoCapitalize="off" spellCheck={false} className="mt-2 w-full rounded-lg border bg-background p-3 font-mono text-xs" placeholder="Generate an offer here, or paste the other browser's offer/answer." />
    <div className="mt-3 flex flex-wrap gap-2"><Button onClick={makeOffer} disabled={busy}>Create offer</Button><Button onClick={makeAnswer} disabled={busy}>Create answer from pasted offer</Button><Button onClick={applyAnswer} disabled={busy}>Apply pasted answer</Button><Button onClick={sendProbe} disabled={channelState!=="Open"||busy}>Send 16 KiB probe</Button><Button onClick={runTransfer} disabled={channelState!=="Open"||busy}>Transfer 1 MiB test</Button><Button onClick={close}>Disconnect</Button><Button onClick={async()=>{try{await navigator.clipboard.writeText(signal);setNote("Signaling JSON copied.");}catch{setNote("Clipboard unavailable. Select and copy the JSON manually.");}}} disabled={!signal}>Copy JSON</Button></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Payload bytes submitted</div><b>{sent.toLocaleString()}</b></div><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Payload bytes received</div><b>{received.toLocaleString()}</b></div><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Current send queue</div><b>{bufferedAmount.toLocaleString()} bytes</b><div className="text-xs text-muted-foreground">Threshold: 65,536 bytes</div></div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Test transfer</div><b>{transferStatus}</b></div><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Receiver SHA-256</div><b>{checksumStatus}</b></div><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Send rate (payload submission)</div><b>{transferRate}</b></div></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Sender SHA-256</div><code className="block break-all text-xs">{senderSha256||"Not generated"}</code></div><div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Receiver SHA-256</div><code className="block break-all text-xs">{receiverSha256||"Waiting for receiver"}</code></div></div><p role="status" className="mt-3 text-sm text-muted-foreground">{note}</p>
    <p className="mt-2 text-xs text-muted-foreground">Security note: WebRTC encrypts data channels at the transport layer. This test uses no public STUN/TURN and does not establish sovereign DHT signaling, libp2p peer identity, Noise authentication, mesh membership, or a production relay path. Never paste signaling JSON from an untrusted party.</p>
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