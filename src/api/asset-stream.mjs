import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(process.env.APEX_MEDIA_ROOT||'/srv/apex/se-x/projects');
function safePath(parts){const target=path.resolve(ROOT,...parts);if(target!==ROOT&&!target.startsWith(ROOT+path.sep))throw new Error('invalid asset path');return target;}
function contentType(file){const ext=path.extname(file).toLowerCase();return({'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.m4a':'audio/mp4','.aac':'audio/aac','.mp3':'audio/mpeg','.wav':'audio/wav'})[ext]||'application/octet-stream';}
export async function streamAsset(req,res,parts){
  const file=safePath(parts);const info=await stat(file);const size=info.size;
  res.setHeader('Content-Type',contentType(file));res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','private, max-age=60');
  const range=req.headers.range;
  if(!range){res.writeHead(200,{'Content-Length':size});return createReadStream(file).pipe(res);}
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}
  let start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));let end=match[2]?Number(match[2]):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}
  end=Math.min(end,size-1);res.writeHead(206,{'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${size}`});return createReadStream(file,{start,end}).pipe(res);
}
