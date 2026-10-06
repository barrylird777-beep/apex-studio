import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
async function ipfs(args,timeoutMs=15000){return exec(process.env.IPFS_BIN||'ipfs',args,{timeout:timeoutMs,maxBuffer:1024*1024});}
export async function swarmPeers(){try{const {stdout}=await ipfs(['swarm','peers']);return stdout.trim().split('\n').filter(Boolean);}catch(error){return{available:false,error:error.message};}}
export async function pinCid(cid){if(!/^[A-Za-z0-9]+$/.test(cid))throw new Error('invalid CID');const {stdout,stderr}=await ipfs(['pin','add',cid],120000);return{cid,stdout:stdout.trim(),stderr:stderr.trim()};}
