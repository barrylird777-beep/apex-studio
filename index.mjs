import { startProductionDaemon } from "./src/workers/av1-production-daemon.mjs";

process.title = "apex-av1-production";

await startProductionDaemon();
