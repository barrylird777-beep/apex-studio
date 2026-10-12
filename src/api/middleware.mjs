import crypto from "node:crypto";
import { redact } from "../core/privacy.mjs";

export function requestId(req,res,next){
  const id=req.get("x-request-id")?.slice(0,128)||crypto.randomUUID();
  req.requestId=id; res.setHeader("x-request-id",id); next();
}

export function securityHeaders(_req,res,next){
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy","same-origin");
  next();
}

export function limitQuery(req,res,next){
  const limit=Number(req.query.limit);
  if(req.query.limit!==undefined && (!Number.isInteger(limit)||limit<1||limit>100)) {
    return res.status(400).json({error:"limit must be an integer between 1 and 100",requestId:req.requestId});
  }
  next();
}

export function asyncRoute(handler){
  return (req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);
}

export function errorHandler(err,req,res,_next){
  const status=Number.isInteger(err?.statusCode)?err.statusCode:500;
  if(status>=500) console.error(JSON.stringify({requestId:req.requestId,error:String(err?.message??err),stack:err?.stack}));
  res.status(status).json({error:status>=500?"Internal server error":String(err?.message??err),requestId:req.requestId});
}

export function safeErrorPayload(value){ return redact(value); }
