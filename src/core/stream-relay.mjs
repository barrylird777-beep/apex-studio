import { spawn } from 'node:child_process';

const DEFAULT_RESTART_MS=2000;

export function buildPassThroughArgs({ingest,dest}={}){
  if(!ingest)throw new TypeError('ingest source is required');
  if(!dest)throw new TypeError('destination endpoint is required');
  return ['-hide_banner','-loglevel','warning','-fflags','+genpts+nobuffer','-i',ingest,'-c:v','copy','-c:a','copy','-f','flv','-flvflags','no_duration_filesize',dest];
}

export function createStreamRelay({ingestSource,destEndpoint,ffmpegPath='ffmpeg',restartMs=DEFAULT_RESTART_MS}={}){
  const state={status:'idle',pid:null,starts:0,restarts:0,lastExitCode:null,lastSignal:null,lastError:null,startedAt:null};
  let child=null;let stopping=false;let timer=null;
  const clear=()=>{if(timer){clearTimeout(timer);timer=null;}};
  const start=()=>{
    if(stopping||child)return;
    if(!ingestSource||!destEndpoint){state.status='disabled';return;}
    state.status='connecting';state.starts++;state.startedAt ||= new Date().toISOString();
    child=spawn(ffmpegPath,buildPassThroughArgs({ingest:ingestSource,dest:destEndpoint}),{stdio:['ignore','ignore','pipe']});
    state.pid=child.pid??null;
    child.stderr.on('data',chunk=>{const s=String(chunk).trim();if(/error|failed|refused|broken pipe|invalid/i.test(s))state.lastError=s.slice(-2000);});
    child.once('error',error=>{state.lastError=String(error?.message||error);});
    child.once('exit',(code,signal)=>{
      state.lastExitCode=code;state.lastSignal=signal;state.pid=null;child=null;
      if(stopping){state.status='stopped';return;}
      state.restarts++;state.status='restarting';clear();
      timer=setTimeout(()=>{timer=null;start();},Math.max(250,Number(restartMs)||DEFAULT_RESTART_MS));timer.unref?.();
    });
  };
  return {
    start(){stopping=false;clear();start();return this.status();},
    stop(){stopping=true;clear();if(child)child.kill('SIGTERM');state.status='stopped';return this.status();},
    status(){return {...state,configured:Boolean(ingestSource&&destEndpoint)}}
  };
}
