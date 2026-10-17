import crypto from "node:crypto";
import { redact } from "../core/privacy.mjs";

export function requestId(req,res,next){
  const supplied=req.get("x-request-id");
  const id=typeof supplied==="string" && /^[A-Za-z0-9._-]{1,64}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
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
  const candidate=Number(err?.statusCode);
  const status=Number.isInteger(candidate)&&candidate>=400&&candidate<500?candidate:500;
  if(status>=500) {
    // Never log raw errors: messages/stacks can contain credentials or private payloads.
    const errorClass=typeof err?.name==="string"&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(err.name)?err.name:"Error";
    const errorCode=typeof err?.code==="string"&&/^[A-Z0-9_]{1,64}$/.test(err.code)?err.code:undefined;
    console.error(JSON.stringify({requestId:req.requestId,errorClass,...(errorCode?{errorCode}:{})}));
  }
  const safeClientMessage=status===404?"Not found":
    status===401?"Unauthorized":
    status===403?"Forbidden":
    status===429?"Too many requests":
    status===400?"Bad request":
    "Request failed";
  res.status(status).json({error:safeClientMessage,requestId:req.requestId});
}

export function safeErrorPayload(value){ return redact(value); }
