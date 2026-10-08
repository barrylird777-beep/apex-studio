import { createInfiniteBroadcast } from "./infinite-broadcast.mjs";
import { buildNetworkSchedule } from "./teevee-network-scheduler.mjs";
import { broadcastStatus, currentScheduleWindow, isScheduleContinuous } from "./teevee-broadcast-controller.mjs";
import { getApexApp } from "../apps/apex-six-apps.mjs";

const APP = getApexApp("teevee");

export function createTeeVeeBroadcast(options = {}) {
  const controller = createInfiniteBroadcast(options);
  return Object.freeze({
    app: { ...APP },
    async start() { return controller.start(); },
    async stop() { return controller.stop(); },
    status() {
      return { app: { ...APP }, ...controller.status(), network: "24/7 TV" };
    }
  });
}

export function buildTeeVeeSchedule({ episodes, startAt, horizonMinutes = 1440 } = {}) {
  const rows = buildNetworkSchedule({ episodes, startAt, horizonMinutes });
  return {
    app: { ...APP },
    network: "TeeVee",
    mode: "24/7-linear",
    continuous: isScheduleContinuous(rows),
    rows
  };
}

export function teeveeScheduleStatus(rows = [], now = new Date()) {
  return {
    app: { ...APP },
    network: "TeeVee",
    mode: "24/7-linear",
    ...broadcastStatus({ rows, now })
  };
}

export function teeveeStatus() {
  return {
    app: { ...APP },
    product: "24/7 TV show/network",
    mode: "continuous-linear-programming",
    scheduling: "durable schedule",
    broadcast: "RTMP/FFmpeg capable",
    continuousScheduling: true,
    checkedAt: new Date().toISOString()
  };
}