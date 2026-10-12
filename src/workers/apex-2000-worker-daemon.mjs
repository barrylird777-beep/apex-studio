import { pathToFileURL } from "node:url";
import { runApexPureWalWorkerDaemon } from "./apex-2000-worker-pure-wal-daemon.mjs";

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runApexPureWalWorkerDaemon().catch(error => {
    console.error("[APEX PURE-WAL WORKERS] fatal", error);
    process.exitCode = 1;
  });
}
