import { startShowrunner, showrunnerStatus } from "../src/workers/showrunner.mjs";

startShowrunner();
console.log("[apex-showrunner] status", showrunnerStatus());

const shutdown = async signal => {
  console.log("[apex-showrunner]", signal, "received; stopping");
  const { stopShowrunner } = await import("../src/workers/showrunner.mjs");
  await stopShowrunner();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
