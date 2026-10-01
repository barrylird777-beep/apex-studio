import crypto from "node:crypto";
const ALG="aes-256-gcm";
export function encryptJson(value,key){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv(ALG,key,iv);
 const data=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
 return {iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:data.toString("base64")};
}
export function decryptJson(payload,key){
 const decipher=crypto.createDecipheriv(ALG,key,Buffer.from(payload.iv,"base64"));
 decipher.setAuthTag(Buffer.from(payload.tag,"base64"));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data,"base64")),decipher.final()]).toString("utf8"));
}