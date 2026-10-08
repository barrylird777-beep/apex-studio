import { createTeeVeeBroadcast, buildTeeVeeSchedule, teeveeScheduleStatus } from "../core/teevee-broadcast.mjs";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("teevee");

export function createTeeVeeBroadcastSurface(options = {}) {
  return createTeeVeeBroadcast(options);
}

export function buildTeeVeeProgramming(input = {}) {
  return buildTeeVeeSchedule(input);
}

export function getTeeVeeScheduleStatus(rows = [], now = new Date()) {
  return teeveeScheduleStatus(rows, now);
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