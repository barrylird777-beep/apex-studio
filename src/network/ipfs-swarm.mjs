import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const exec=promisify(execFile);
const IPFS_BIN=process.env.IPFS_BIN||'ipfs';
const IPFS_PATH=process.env.IPFS_PATH||'/srv/apex/se-x/ipfs';
const env={...process.env,IPFS_PATH};
async function ipfs(args,timeoutMs=15000){return exec(IPFS_BIN,args,{timeout:timeoutMs,maxBuffer:4*1024*1024,env});}
export async function ensureLocalIpfs(){return ipfs(['id'],15000);}
export async function swarmPeers(){try{const {stdout}=await ipfs(['swarm','peers']);return stdout.trim().split('\n').filter(Boolean);}catch(error){return{available:false,error:error.message};}}
export async function pinCid(cid){if(!/^[A-Za-z0-9]+$/.test(cid))throw new Error('invalid CID');const {stdout,stderr}=await ipfs(['pin','add',cid],120000);return{cid,stdout:stdout.trim(),stderr:stderr.trim()};}
export async function addFile(file){const resolved=path.resolve(file);const root=path.resolve('/srv/apex/se-x');if(!resolved.startsWith(root+path.sep))throw new Error('IPFS add restricted to /srv/apex/se-x');const {stdout}=await ipfs(['add','--pin','-Q',resolved],120000);return stdout.trim();}
export {IPFS_PATH};