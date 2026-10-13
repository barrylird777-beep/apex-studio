import test from "node:test";
import assert from "node:assert/strict";
import { createPrivacyPolicy } from "../src/core/privacy.mjs";

test("privacy-sensitive settings cannot be enabled by caller options",()=>{
  const previous=process.env.APEX_ALLOW_REMOTE_PROVIDERS;
  delete process.env.APEX_ALLOW_REMOTE_PROVIDERS;
  try {
    const policy=createPrivacyPolicy({
      telemetry:true,
      remoteProviders:true,
      remoteSync:true,
      crashReporting:true,
      localOnly:false,
      label:"custom metadata"
    });
    assert.equal(policy.telemetry,false);
    assert.equal(policy.remoteProviders,false);
    assert.equal(policy.remoteSync,false);
    assert.equal(policy.crashReporting,false);
    assert.equal(policy.localOnly,true);
    assert.equal(policy.label,"custom metadata");
  } finally {
    if(previous===undefined) delete process.env.APEX_ALLOW_REMOTE_PROVIDERS;
    else process.env.APEX_ALLOW_REMOTE_PROVIDERS=previous;
  }
});

test("remote providers require the explicit environment opt-in",()=>{
  const previous=process.env.APEX_ALLOW_REMOTE_PROVIDERS;
  try {
    process.env.APEX_ALLOW_REMOTE_PROVIDERS="true";
    const policy=createPrivacyPolicy({remoteProviders:false,localOnly:true});
    assert.equal(policy.remoteProviders,true);
    assert.equal(policy.localOnly,false);
    assert.equal(policy.telemetry,false);
    assert.equal(policy.remoteSync,false);
    assert.equal(policy.crashReporting,false);
  } finally {
    if(previous===undefined) delete process.env.APEX_ALLOW_REMOTE_PROVIDERS;
    else process.env.APEX_ALLOW_REMOTE_PROVIDERS=previous;
  }
});
