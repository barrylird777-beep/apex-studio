import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { handleStudioAdBlockDoH } from "../src/network/studio-adblock-doh.mjs";
function queryFor(hostname){const labels=hostname.split(".");const parts=[];for(const label of labels)parts.push(Buffer.concat([Buffer.from([label.length]),Buffer.from(label)]));parts.push(Buffer.from([0]));const header=Buffer.alloc(12);header.writeUInt16BE(0x1234,0);header.writeUInt16BE(0x0100,2);header.writeUInt16BE(1,4);return Buffer.concat([header,...parts,Buffer.from([0,1,0,1])]);}
test("Studio ad blocker returns NXDOMAIN for blocked domains",async()=>{const server=createServer((req,res)=>handleStudioAdBlockDoH(req,res,new URL(req.url,"http://localhost")));await new Promise(resolve=>server.listen(0,resolve));const port=server.address().port;const query=queryFor("doubleclick.net");const response=await fetch("http://127.0.0.1:"+port+"/?dns="+query.toString("base64url"));const body=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);assert.equal(body.readUInt16BE(0),0x1234);assert.equal(body[3]&0x0f,3);await new Promise(resolve=>server.close(resolve));});
