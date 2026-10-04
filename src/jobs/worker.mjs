import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createStatusHandler } from './status.mjs';

const same=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};

export function startStatusServer({queue,token,port,host='127.0.0.1'}){
  if(!token)throw new Error('status server requires a token');
  const handler=createStatusHandler(queue);
  const server=http.createServer(async(req,res)=>{
    if(!same(req.headers.authorization??'',`Bearer ${token}`)){res.statusCode=401;res.end('unauthorized');return;}
    try{if(!(await handler(req,res))){res.statusCode=404;res.end('not found');}}
    catch{res.statusCode=500;res.end('error');}
  });
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>resolve(server));});
}
