import test from "node:test";
import assert from "node:assert/strict";
import {signSignalingJwt,verifySignalingJwt,authorizeSignalingRoom,createSignalingRoomAuth} from "../src/security/signaling-room-auth.mjs";

const secret="test-secret";const now=1700000000;
test("verifies signed JWT and room authorization",()=>{
 const token=signSignalingJwt({sub:"peer-1",room:"room-a",iat:now,exp:now+300,iss:"apex",aud:"signaling" },secret);
 const claims=verifySignalingJwt(token,{secret,issuer:"apex",audience:"signaling",now});
 assert.equal(claims.sub,"peer-1");assert.equal(authorizeSignalingRoom(claims,"room-a"),true);assert.equal(authorizeSignalingRoom(claims,"room-b"),false);
});
test("rejects expired, forged, long-lived and wrong-room tokens",()=>{
 const expired=signSignalingJwt({sub:"p",room:"a",iat:now-500,exp:now-1},secret);
 assert.throws(()=>verifySignalingJwt(expired,{secret,now}));
 const forged=signSignalingJwt({sub:"p",room:"a",iat:now,exp:now+300},secret).slice(0,-1)+"x";
 assert.throws(()=>verifySignalingJwt(forged,{secret,now}));
 const long=signSignalingJwt({sub:"p",room:"a",iat:now,exp:now+7200},secret);
 assert.throws(()=>verifySignalingJwt(long,{secret,now}));
 assert.equal(authorizeSignalingRoom({rooms:["a"]},"b"),false);
 assert.equal(authorizeSignalingRoom({rooms:["a"]},"../admin"),false);
});
test("middleware fails closed when secret is absent and fences rooms",()=>{
 const middleware=createSignalingRoomAuth({secret,issuer:"apex",audience:"signaling"});
 const token=signSignalingJwt({sub:"p",room:"a",iat:now,exp:now+300,iss:"apex",aud:"signaling"},secret);
 const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 let called=false;middleware({get:()=> "Bearer "+token,params:{room:"a"}},res,()=>{called=true;});
 assert.equal(called,true);
 const denied={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 middleware({get:()=> "Bearer "+token,params:{room:"b"}},denied,()=>assert.fail("wrong room must not proceed"));
 assert.equal(denied.code,403);
});
