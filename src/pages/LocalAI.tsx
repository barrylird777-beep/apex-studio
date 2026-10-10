import {useEffect, useRef, useState} from "react";
import {Wllama} from "@wllama/wllama";
import WasmFromCDN from "@wllama/wllama/esm/wasm-from-cdn.js";
import "./LocalAI.css";

function isAppleMobile():boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
}

export default function LocalAI(){
  const engine=useRef<Wllama|null>(null);
  const [fileName,setFileName]=useState("");
  const [fileSize,setFileSize]=useState(0);
  const [prompt,setPrompt]=useState("Explain artificial intelligence in simple terms, using three short sentences.");
  const [output,setOutput]=useState("");
  const [status,setStatus]=useState("Choose a GGUF model stored in Files to begin.");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [running,setRunning]=useState(false);
  const [ready,setReady]=useState(false);
  const [offlineConfirmed,setOfflineConfirmed]=useState(false);
  const [lastRun,setLastRun]=useState("");
  const safari=isAppleMobile();
  const wasmSupported=typeof WebAssembly!=="undefined" && typeof WebAssembly.instantiate==="function";

  useEffect(()=>()=>{if(engine.current){void engine.current.exit().catch(()=>{});engine.current=null;}},[]);

  async function loadModel(event:React.ChangeEvent<HTMLInputElement>){
    const files=Array.from(event.currentTarget.files??[]);
    event.currentTarget.value="";
    if(!files.length)return;
    const file=files[0];
    setError("");setOutput("");setReady(false);setLoading(true);setStatus("Preparing local runtime…");
    if(engine.current){try{await engine.current.exit();}catch{}engine.current=null;}
    try{
      if(!wasmSupported)throw new Error("This browser does not expose the WebAssembly features required by the local runtime.");
      if(!file.name.toLowerCase().endsWith(".gguf"))throw new Error("Choose a .gguf model file.");
      if(file.size<=0)throw new Error("The selected model file is empty.");
      const runtime=new Wllama(WasmFromCDN);
      // Wllama's default compatibility mode enables its Safari-compatible worker/WASM build.
      runtime.setCompat("default");
      engine.current=runtime;
      setStatus("Loading model into this device's memory. Keep this page open…");
      await runtime.loadModel(files,{n_threads:1,n_ctx:1024,n_gpu_layers:0});
      setFileName(file.name);setFileSize(file.size);setReady(true);
      setStatus("Model loaded in this browser session. You can now run a prompt.");
    }catch(e){
      if(engine.current){try{await engine.current.exit();}catch{}engine.current=null;}
      setError(e instanceof Error?e.message:String(e));
      setStatus("Model did not load. Your original GGUF file was not changed.");
    }finally{setLoading(false);}
  }

  async function runInference(offlineTest:boolean){
    if(!engine.current||!ready){setError("Load a GGUF model first.");return;}
    if(offlineTest&&!offlineConfirmed){setError("First turn off Wi-Fi and cellular data, then confirm the device is disconnected.");return;}
    setError("");setOutput("");setRunning(true);setLastRun("");setStatus(offlineTest?"Running the offline inference check…":"Generating locally…");
    let text="";
    try{
      await engine.current.createCompletion({
        prompt,
        max_tokens:128,
        temperature:0.5,
        top_k:40,
        top_p:0.9,
        stream:true,
        onData:(chunk:{choices:Array<{text:string}>})=>{text+=chunk.choices?.[0]?.text??"";setOutput(text);}
      });
      if(!text.trim())throw new Error("The runtime finished without returning text. Try a shorter prompt or a different GGUF model.");
      const label=offlineTest
        ? "PASS — a response was generated after you confirmed Wi-Fi and cellular data were off. This verifies local inference for this run; it is not an independent network audit."
        : "Inference returned text. Offline operation has not yet been verified.";
      setLastRun(label);setStatus("Generation finished.");
    }catch(e){
      setError(e instanceof Error?e.message:String(e));setStatus("Generation failed. The model file remains unchanged.");
    }finally{setRunning(false);}
  }

  return <main className="local-ai-page">
    <section className="local-ai-hero">
      <p className="local-ai-eyebrow">APEX STUDIO / ON-DEVICE INTELLIGENCE</p>
      <h1>Local AI</h1>
      <p>Run a GGUF model in this browser. After the model and runtime assets load, generation runs through the on-device WebAssembly runtime.</p>
      <div className="local-ai-pills"><span>{safari?"Apple mobile browser detected":"Browser environment detected"}</span><span>{wasmSupported?"WebAssembly available":"WebAssembly unavailable"}</span><span>{navigator.onLine?"Network currently reported online":"Browser reports offline"}</span></div>
    </section>

    <section className="local-ai-card">
      <div className="local-ai-card-head"><div><p className="local-ai-eyebrow">STEP 1</p><h2>Choose your model</h2></div><span className={ready?"local-ai-state good":"local-ai-state"}>{ready?"MODEL READY":loading?"LOADING":"NOT LOADED"}</span></div>
      <p className="local-ai-help">Choose a small, quantized GGUF file from the iPhone Files app. Start with a tiny model; large models can exceed mobile memory limits.</p>
      <input className="local-ai-file" type="file" accept=".gguf,application/octet-stream" onChange={loadModel} disabled={loading||running} aria-label="Choose a GGUF model"/>
      <p className="local-ai-help">Need a tiny test model? <a href="https://huggingface.co/ggml-org/models/resolve/main/tinyllamas/stories15M-q4_0.gguf" target="_blank" rel="noreferrer">Open the 19 MB test model</a>, save it to Files, then select it here. The first runtime load needs internet to fetch its WebAssembly assets.</p>
      {loading&&<div className="local-ai-progress"><span>{status}</span><progress/></div>}
      {ready&&<div className="local-ai-model-summary"><strong>{fileName}</strong><span>{(fileSize/1024/1024).toFixed(1)} MB · loaded in browser memory</span></div>}
      <p className="local-ai-status" role="status">{status}</p>
      {error&&<div className="local-ai-error" role="alert"><strong>Something needs attention</strong><p>{error}</p></div>}
    </section>

    <section className="local-ai-card">
      <div className="local-ai-card-head"><div><p className="local-ai-eyebrow">STEP 2</p><h2>Prompt the model</h2></div><span className="local-ai-state">LOCAL RUNTIME</span></div>
      <label className="local-ai-label" htmlFor="local-ai-prompt">Your prompt</label>
      <textarea id="local-ai-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} rows={5} placeholder="Ask your local model something…" disabled={running}/>
      <div className="local-ai-actions"><button type="button" onClick={()=>void runInference(false)} disabled={!ready||loading||running||!prompt.trim()}>{running?"Generating…":"Run locally"}</button><button type="button" className="secondary" onClick={()=>{setPrompt("Explain artificial intelligence in simple terms, using three short sentences.");setOutput("");setError("");}} disabled={running}>Reset prompt</button></div>
      <label className="local-ai-label" htmlFor="local-ai-output">Generated response</label>
      <div id="local-ai-output" className="local-ai-output" aria-live="polite">{output||"Your model's response will appear here."}</div>
      {lastRun&&<p className={lastRun.startsWith("PASS")?"local-ai-pass":"local-ai-status"} role="status">{lastRun}</p>}
    </section>

    <section className="local-ai-card offline-card">
      <p className="local-ai-eyebrow">STEP 3 · REAL DEVICE CHECK</p><h2>Verify inference while offline</h2>
      <p className="local-ai-help">Load the model first. Then turn on Airplane Mode (or turn off both Wi-Fi and cellular data) without closing this page. Confirm below and run the prompt. A response produced while disconnected is evidence that inference is local for that run. The browser's online indicator alone cannot prove this.</p>
      <label className="local-ai-confirm"><input type="checkbox" checked={offlineConfirmed} onChange={e=>setOfflineConfirmed(e.target.checked)} disabled={running}/> I have turned off Wi-Fi and cellular data on this device.</label>
      <button type="button" className="offline-button" onClick={()=>void runInference(true)} disabled={!ready||loading||running||!prompt.trim()||!offlineConfirmed}>Run offline inference check</button>
      <p className="local-ai-footnote">The WebAssembly runtime may need to be loaded once while online. This screen does not claim offline verification until a response is generated after you disconnect. The model and prompt are processed by the browser runtime, not an Apex server inference endpoint.</p>
    </section>
  </main>;
}
