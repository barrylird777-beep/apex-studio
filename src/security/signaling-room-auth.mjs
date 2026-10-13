import crypto from "node:crypto";

const b64url=value=>Buffer.from(value).toString("base64url");
function safeEqual(a,b){const left=Buffer.from(String(a));const right=Buffer.from(String(b));return left.length===right.length&&crypto.timingSafeEqual(left,right);}
export function verifySignalingJwt(token,{secret=process.env.APEX_SIGNALING_JWT_SECRET,issuer=process.env.APEX_SIGNALING_JWT_ISSUER,audience=process.env.APEX_SIGNALING_JWT_AUDIENCE,now=Math.floor(Date.now()/1000)}={}){
  if(!secret)throw Object.assign(new Error("Signaling authentication is not configured"),{statusCode:503});
  if(typeof token!=="string"||token.length>8192)throw Object.assign(new Error("Unauthorized"),{statusCode:401});
  const parts=token.split(".");
  if(parts.length!==3)throw Object.assign(new Error("Unauthorized"),{statusCode:401});
  let header,payload;
  try{header=JSON.parse(Buffer.from(parts[0],"base64url").toString());payload=JSON.parse(Buffer.from(parts[1],"base64url").toString());}catch{throw Object.assign(new Error("Unauthorized"),{statusCode:401});}
  if(header?.alg!=="HS256"||header?.typ&&header.typ!=="JWT")throw Object.assign(new Error("Unauthorized"),{statusCode:401});
  const expected=crypto.createHmac("sha256",secret).update(parts[0]+"."+parts[1]).digest("base64url");
  if(!safeEqual(expected,parts[2]))throw Object.assign(new Error("Unauthorized"),{statusCode:401});
  if(!Number.isFinite(payload.exp)||payload.exp<=now||payload.iat!==undefined&&(!Number.isFinite(payload.iat)||payload.iat>now+30)||payload.nbf!==undefined&&(!Number.isFinite(payload.nbf)||payload.nbf>now))throw Object.assign(new Error("Unauthorized"),{statusCode:401});
  if(payload.exp-now>3600)throw Object.assign(new Error("Unauthorized"),{statusCode:401});
  if(issuer&&payload.iss!==issuer)throw Object.assign(new Error("Unauthorized"),{statusCode:401});
  if(audience&&!(payload.aud===audience||Array.isArray(payload.aud)&&payload.aud.includes(audience)))throw Object.assign(new Error("Unauthorized"),{statusCode:401});
  if(typeof payload.sub!=="string"||!payload.sub||payload.sub.length>160)throw Object.assign(new Error("Unauthorized"),{statusCode:401});
  return payload;
}
export function authorizeSignalingRoom(claims,room){
  if(typeof room!=="string"||! /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(room))return false;
  const rooms=Array.isArray(claims?.rooms)?claims.rooms:[claims?.room].filter(Boolean);
  return rooms.includes(room);
}
export function createSignalingRoomAuth({secret,issuer,audience}={}){
  return function signalingRoomAuth(req,res,next){
    try{
      const match=/^Bearer\s+([^\s]+)$/i.exec(String(req.get?.("authorization")||req.headers?.authorization||""));
      const claims=verifySignalingJwt(match?.[1],{secret,issuer,audience});
      const room=String(req.params?.room??req.body?.room??req.query?.room??"");
      if(!authorizeSignalingRoom(claims,room))return res.status(403).json({success:false,error:"Room access denied"});
      req.signalingClaims=claims;req.signalingRoom=room;
      return next();
    }catch(error){return res.status(error.statusCode||401).json({success:false,error:error.statusCode===503?"Signaling authentication is not configured":"Unauthorized"});}
  };
}
export function signSignalingJwt(payload,secret){
  const header=b64url(JSON.stringify({alg:"HS256",typ:"JWT"}));
  const body=b64url(JSON.stringify(payload));
  const signature=crypto.createHmac("sha256",secret).update(header+"."+body).digest("base64url");
  return header+"."+body+"."+signature;
}
