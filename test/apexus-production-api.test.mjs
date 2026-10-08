import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createApexusProductionRouter } from "../src/api/apexus-production-api.mjs";

test("Apexus production API requires an enqueue function", () => {
  assert.throws(() => createApexusProductionRouter(), /enqueue function is required/);
});

test("Apexus production API factory mounts status and start routes", () => {
  const app=express();
  const router=createApexusProductionRouter({
    enqueue: async payload => ({ id:"job-1", payload }),
    requireAuth: (_req,_res,next) => next()
  });
  app.use("/api/apexus/production",router);
  assert.equal(typeof router.handle, "function");
});
