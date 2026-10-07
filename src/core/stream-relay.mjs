import { spawn } from 'node:child_process';

const DEFAULT_RESTART_MS=2000;
const DEFAULT_PROBE_TIMEOUT_MS=10000;
const VIDEO_COPY_CODECS=new Set(['h264','hevc']);
const AUDIO_COPY_CODECS=new Set(['aac','mp3']);

function required(value,name){if(!value)throw new TypeError(name+' is required');}

export function buildPassThroughArgs({ingest,dest}={}){
  required(ingest,'ingest source');
  required(dest,'destination endpoint');
  return ['-hide_banner','-loglevel','warning','-fflags','+genpts+nobuffer','-i',ingest,'-c:v','copy','-c:a','copy','-f','flv','-flvflags','no_duration_filesize',dest];
}

export function buildTranscodeArgs({ingest,dest,encoder='libx264'}={}){
  required(ingest,'ingest source');
  required(dest,'destination endpoint');
  const video=encoder==='h264_nvenc'
    ? ['-c:v','h264_nvenc','-preset','p1','-tune','ll','-pix_fmt','yuv420p','-b:v','4500k','-maxrate','5000k','-bufsize','9000k']
    : ['-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-pix_fmt','yuv420p','-b:v','4500k','-maxrate','5000k','-bufsize','9000k'];
  return ['-hide_banner','-loglevel','warning','-fflags','+genpts+nobuffer','-i',ingest,...video,'-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-f','flv','-flvflags','no_duration_filesize',dest];
}

export function canCopyProbe(probe={}){
  const streams=Array.isArray(probe.streams)?probe.streams:[];
  const video=streams.find(s=>s.codec_type==='video');
  const audio=streams.find(s=>s.codec_type==='audio');
  return Boolean(video&&audio&&VIDEO_COPY_CODECS.has(String(video.codec_name).toLowerCase())&&AUDIO_COPY_CODECS.has(String(audio.codec_name).toLowerCase()));
}

export function selectRelayMode(probe,{preferNvenc=false}={}){
  if(canCopyProbe(probe))return {mode:'copy',encoder:null};
  return {mode:'transcode',encoder:preferNvenc?'h264_nvenc':'libx264'};
}

function probeInput({ffprobePath,ingest,timeoutMs}){
  return new Promise((resolve,reject)=>{
    const child=spawn(ffprobePath,['-v','error','-show_streams','-show_format','-of','json',ingest],{stdio:['ignore','pipe','pipe']});
    let out='',err='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('ffprobe timeout'));},timeoutMs);
    child.stdout.on('data',b=>out+=String(b));
    child.stderr.on('data',b=>err=(err+String(b)).slice(-4000));
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',(code,signal)=>{
      clearTimeout(timer);
      if(code!==0)return reject(new Error('ffprobe failed: '+(err||code||signal)));
      try{resolve(JSON.parse(out));}catch(e){reject(new Error('ffprobe returned invalid JSON: '+e.message));}
    });
  });
}

export function createStreamRelay({
  ingestSource,
  destEndpoint,
  ffmpegPath='ffmpeg',
  ffprobePath='ffprobe',
  restartMs=DEFAULT_RESTART_MS,
  probeTimeoutMs=DEFAULT_PROBE_TIMEOUT_MS,
  preferNvenc=false
}={}){
  const state={status:'idle',mode:null,encoder:null,probe:null,pid:null,starts:0,restarts:0,lastExitCode:null,lastSignal:null,lastError:null,startedAt:null,lastProbeAt:null};
  let child=null,stopping=false,timer=null;
  const clear=()=>{if(timer){clearTimeout(timer);timer=null;}};

  async function start(){
    if(stopping||child)return status();
    if(!ingestSource||!destEndpoint){state.status='disabled';return status();}
    state.status='probing';
    try{
      const probe=await probeInput({ffprobePath,ingest:ingestSource,timeoutMs:Math.max(1000,Number(probeTimeoutMs)||DEFAULT_PROBE_TIMEOUT_MS)});
      const route=selectRelayMode(probe,{preferNvenc});
      state.probe=probe;
      state.mode=route.mode;
      state.encoder=route.encoder;
      state.lastProbeAt=new Date().toISOString();
      state.lastError=null;
      const args=route.mode==='copy'
        ? buildPassThroughArgs({ingest:ingestSource,dest:destEndpoint})
        : buildTranscodeArgs({ingest:ingestSource,dest:destEndpoint,encoder:route.encoder});
      state.status='connecting';
      state.starts++;
      state.startedAt ||= new Date().toISOString();
      child=spawn(ffmpegPath,args,{stdio:['ignore','ignore','pipe']});
      state.pid=child.pid??null;
      child.stderr.on('data',chunk=>{const s=String(chunk).trim();if(/error|failed|refused|broken pipe|invalid/i.test(s))state.lastError=s.slice(-2000);});
      child.once('error',error=>{state.lastError=String(error?.message||error);});
      child.once('exit',(code,signal)=>{
        state.lastExitCode=code;state.lastSignal=signal;state.pid=null;child=null;
        if(stopping){state.status='stopped';return;}
        state.restarts++;state.status='restarting';clear();
        timer=setTimeout(()=>{timer=null;void start();},Math.max(250,Number(restartMs)||DEFAULT_RESTART_MS));
        timer.unref?.();
      });
    }catch(error){
      state.lastError=String(error?.message||error);
      state.status='probe-failed';
      if(!stopping){
        clear();
        timer=setTimeout(()=>{timer=null;void start();},Math.max(250,Number(restartMs)||DEFAULT_RESTART_MS));
        timer.unref?.();
      }
    }
    return status();
  }

  function stop(){stopping=true;clear();if(child)child.kill('SIGTERM');state.status='stopped';return status();}
  function status(){return {...state,configured:Boolean(ingestSource&&destEndpoint),copyEligible:state.probe?canCopyProbe(state.probe):null};}
  return {start,stop,status};
}
