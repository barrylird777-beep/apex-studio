import { startFreeBroadcast, stopFreeBroadcast, showrunnerStatus } from "../broadcast/free-broadcast.mjs";

let timer = null;

export function startShowrunner() {
  const status = startFreeBroadcast();
  if (timer) return status;
  timer = setInterval(() => {
    const current = showrunnerStatus();
    if (current.enabled && !current.running) startFreeBroadcast();
  }, 15000);
  timer.unref?.();
  return status;
}

export async function stopShowrunner() {
  if (timer) clearInterval(timer);
  timer = null;
  await stopFreeBroadcast();
}

export { showrunnerStatus };
