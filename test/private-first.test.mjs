import test from "node:test";
import assert from "node:assert/strict";
import { EgressPolicy } from "../src/core/egress.mjs";
import { encryptJson,decryptJson } from "../src/core/encrypted-store.mjs";

test("egress is denied by default",()=>{const p=new EgressPolicy();assert.throws(()=>p.check("https://example.com","test"),/blocked/);});
test("egress can be allowlisted explicitly",()=>{const p=new EgressPolicy({allowRemote:true,allowedHosts:["example.com"]});assert.equal(p.check("https://example.com/x").allowed,true);});
test("encrypted store round-trips JSON",()=>{const key=Buffer.alloc(32,7),payload=encryptJson({secret:"value"},key);assert.deepEqual(decryptJson(payload,key),{secret:"value"});});
