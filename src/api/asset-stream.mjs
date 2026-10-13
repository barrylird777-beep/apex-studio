import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveContainedPath } from '../core/se-x-paths.mjs';

const ROOT=path.resolve(process.env.APEX_MEDIA_ROOT||process.env.APEX_PROJECTS_DIR||'/srv/apex/se-x/projects');
async function safePath(parts){
  if(!Array.isArray(parts)||parts.length===0||parts.some(part=>typeof part!=='string'))throw new TypeError('invalid asset path');
  return resolveContainedPath(ROOT,parts.join('/'),{mustExist:true,allowMissingLeaf:false});
}
function contentType(file){const ext=path.extname(file).toLowerCase();return({'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.m4a':'audio/mp4','.aac':'audio/aac','.mp3':'audio/mpeg','.wav':'audio/wav'})[ext]||'application/octet-stream';}
export async function streamAsset(req,res,parts){
  const file=await safePath(parts);const info=await stat(file);if(!info.isFile())throw new TypeError('asset path is not a file');const size=info.size;
  res.setHeader('Content-Type',contentType(file));res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','private, max-age=60');
  const range=req.headers.range;
  if(!range){res.writeHead(200,{'Content-Length':size});return createReadStream(file).pipe(res);}
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}
  let start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));let end=match[2]?Number(match[2]):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}
  end=Math.min(end,size-1);res.writeHead(206,{'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${size}`});return createReadStream(file,{start,end}).pipe(res);
}
