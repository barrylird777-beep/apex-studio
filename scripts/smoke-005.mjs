const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PATHS = {
  projects: '/api/projects',
  scenes: (p) => `/api/projects/${p}/scenes`,
  days: (p) => `/api/projects/${p}/shoot-days`,
  assign: (d) => `/api/shoot-days/${d}/scenes`,
  day: (d) => `/api/shoot-days/${d}`,
  unassign: (s) => `/api/scenes/${s}/assignment`,
  calendar: (p) => `/api/projects/${p}/calendar`,
  auto: (p) => `/api/projects/${p}/auto-schedule`,
};

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const call = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

// Create a project and three scenes through the real HTTP API.
// IDs come from the server responses; nothing is assumed about SQLite row IDs.
async function setup() {
  let r = await call('POST', PATHS.projects, {
    title: `SPEC-005 smoke ${Date.now()}`,
    primaryScripture: 'Genesis 22',
  });
  if (r.status !== 201 || !r.data?.id) throw new Error(`project setup failed: ${r.status} ${JSON.stringify(r.data)}`);
  const projectId = r.data.id;

  const specs = [
    { title: 'Scene A', scriptureRef: 'Genesis 22:1', location: 'Camp', dayOrNight: 'DAY', actionSummary: 'A' },
    { title: 'Scene B', scriptureRef: 'Genesis 22:2', location: 'Camp', dayOrNight: 'DAY', actionSummary: 'B' },
    { title: 'Scene C', scriptureRef: 'Genesis 22:3', location: 'Moriah', dayOrNight: 'NIGHT', actionSummary: 'C' },
  ];
  const sceneIds = [];
  for (const scene of specs) {
    r = await call('POST', PATHS.scenes(projectId), scene);
    if (r.status !== 201 || !r.data?.id) throw new Error(`scene setup failed: ${r.status} ${JSON.stringify(r.data)}`);
    sceneIds.push(r.data.id);
  }
  return { projectId, sceneIds };
}

const view = (cal) => ({
  days: cal.days.map((d) => ({ id: d.id, sceneIds: d.scenes.map((s) => s.id) })),
  unassigned: cal.unassigned.map((s) => s.id),
});
const cal = async (p) => view((await call('GET', PATHS.calendar(p))).data);

const { projectId: P, sceneIds: [a, b, c] } = await setup();
let r = await call('POST', PATHS.days(P), { shootDate: '2026-02-30' });
ok(r.status === 400, 'impossible date rejected');
r = await call('POST', PATHS.days(P), { shootDate: '2026-11-01' });
ok(r.status === 201, 'day 1 created');
const d1 = r.data.id;
r = await call('POST', PATHS.days(P), { shootDate: '2026-11-01' });
ok(r.status === 409, 'duplicate date rejected');
r = await call('POST', PATHS.days(P), { shootDate: '2026-11-02' });
ok(r.status === 201, 'day 2 created');
const d2 = r.data.id;

r = await call('POST', PATHS.assign(d1), { sceneIds: [a, b] });
ok(r.status === 200, 'day 1 assignment accepted');
let v = await cal(P);
ok(same(v.days.find((d) => d.id === d1).sceneIds, [a, b]), 'a,b on day 1 in order');
ok(same(v.unassigned, [c]), 'c unassigned');

r = await call('POST', PATHS.assign(d2), { sceneIds: [b] });
ok(r.status === 200, 'reassignment accepted');
v = await cal(P);
ok(same(v.days.find((d) => d.id === d1).sceneIds, [a]) && same(v.days.find((d) => d.id === d2).sceneIds, [b]), 'b moved, not duplicated');

r = await call('POST', PATHS.assign(d1), { sceneIds: [999999] });
ok(r.status >= 400 && r.status < 500, 'bogus scene id gives 4xx, not 500');

r = await call('DELETE', PATHS.unassign(a));
ok(r.status === 204, 'unassign a');

r = await call('POST', PATHS.auto(P));
ok(r.status === 200, 'auto-schedule runs');

r = await call('DELETE', PATHS.day(d2));
ok(r.status === 204, 'day 2 deleted');
v = await cal(P);
ok(v.unassigned.includes(b), 'deleting a day unassigns its scenes (cascade, scene survives)');

console.log(fails ? `\\n${fails} FAILED` : '\\nALL PASSED');
process.exit(fails ? 1 : 0);
