import { pathToFileURL } from "node:url";
import { runApexPureWalWorkerDaemon } from "./apex-2000-worker-pure-wal-daemon.mjs";

// Compatibility entry point only. The PostgreSQL-backed worker has been
// retired; all execution must use the sovereign Pure-WAL lease/dispatch path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runApexPureWalWorkerDaemon().catch(error => {
    console.error("[APEX PURE-WAL WORKERS] fatal", error);
    process.exitCode = 1;
  });
}

export { runApexPureWalWorkerDaemon };
