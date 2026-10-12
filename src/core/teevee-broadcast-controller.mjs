export function currentScheduleWindow(rows, now = new Date()) {
  const t = new Date(now).getTime();
  const ordered = [...(rows || [])]
    .filter(row => row && row.status !== "cancelled")
    .sort((a,b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  const current = ordered.find(row => {
    const start = new Date(row.starts_at).getTime();
    const end = new Date(row.ends_at).getTime();
    return start <= t && t < end;
  }) || null;

  const upcoming = ordered.filter(row => new Date(row.starts_at).getTime() > t);
  return {
    current,
    next: upcoming[0] || null,
    queue: upcoming.slice(0, 10),
    continuity: current ? "on-air" : "off-air"
  };
}

export function broadcastStatus({ rows = [], now = new Date() } = {}) {
  const window = currentScheduleWindow(rows, now);
  return {
    state: window.current ? "broadcasting" : "waiting",
    continuity: window.continuity,
    current: window.current,
    next: window.next,
    queue: window.queue
  };
}

export function isScheduleContinuous(rows) {
  const ordered = [...(rows || [])]
    .filter(row => row && row.status !== "cancelled")
    .sort((a,b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  for (let i = 1; i < ordered.length; i++) {
    if (new Date(ordered[i].starts_at).getTime() !== new Date(ordered[i - 1].ends_at).getTime()) return false;
  }
  return ordered.length > 0;
}
