import test from "node:test";
import assert from "node:assert/strict";
import { StrategyEngine } from "../src/core/strategy-engine.mjs";
import { DecisionEngine } from "../src/core/decision-engine.mjs";
import { AgentSandbox } from "../src/core/agent-sandbox.mjs";
test("strategy engine tracks evidence and uncertainty",()=>{const e=new StrategyEngine(),s=e.create({name:"Test",assumptions:["A"]});const x=e.evaluate(s.id,[{support:true},{conflict:true}]);assert.equal(x.supportingEvidence,1);assert.equal(x.conflictingEvidence,1);assert.equal(x.uncertainty,"elevated");});
test("decision records preserve unknowns",()=>{const e=new DecisionEngine(),d=e.analyze({question:"Q",unknowns:["U"]});assert.deepEqual(d.unknowns,["U"]);});
test("agent sandbox denies tools not explicitly allowed",async()=>{const s=new AgentSandbox({tools:new Map([["ok",async()=>42]]),allowlist:["ok"]});assert.equal(await s.call("ok"),42);await assert.rejects(()=>s.call("nope"),/denied/);});
