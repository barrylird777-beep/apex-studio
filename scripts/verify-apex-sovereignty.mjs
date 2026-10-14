import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const checks = [
  {
    area: 'runtime/storage',
    file: 'src/core/sovereign-runtime-daemon.mjs',
    forbidden: [
      ['WAL readiness probe', /verifyRemoteWalProbe|remoteWalVerified|remoteWalSequence|remoteWalHash/],
      ['WAL startup retry', /retryWalStartup/],
      ['legacy pure store as active durable store', /apexPureStore/],
      ['filesystem storage migration at runtime startup', /migrateSovereignStorage/],
      ['filesystem-backed mesh engine', /new SovereignMeshEngine\(storageDir\)/],
    ],
  },
  {
    area: 'process orchestration',
    file: 'scripts/start-apex-stack.mjs',
    forbidden: [
      ['filesystem storage migration before startup', /migrateSovereignStorage/],
      ['legacy PostgreSQL archive startup path', /archive.*PostgreSQL|PostgreSQL.*archive/i],
    ],
  },
  {
    area: 'storage primitive',
    file: 'src/core/content-addressed-store.mjs',
    forbidden: [
      ['JSON durable object serialization', /JSON\.stringify|JSON\.parse/],
      ['JSON object/manifest filenames', /\.json/],
      ['local filesystem persistence in production path', /node:fs|readFile|writeFile|mkdir|createWriteStream/],
    ],
  },
  {
    area: 'remote storage',
    file: 'src/core/remote-content-addressed-store.mjs',
    forbidden: [
      ['JSON durable serialization', /JSON\.stringify|JSON\.parse/],
      ['JSON object/manifest filenames', /\.json/],
      ['hosted object store required as system of record', /Remote CAS requires APEX_OBJECT_STORAGE_ENDPOINT/],
    ],
  },
  {
    area: 'deployment',
    file: 'scripts/railway-start.mjs',
    forbidden: [
      ['WAL mode advertised by active launcher', /Pure-WAL mode|WAL mode/i],
    ],
  },
];

let failures = 0;
for (const check of checks) {
  let source;
  try {
    source = await readFile(path.join(root, check.file), 'utf8');
  } catch (error) {
    console.error(`FAIL [${check.area}] cannot read ${check.file}: ${error.message}`);
    failures++;
    continue;
  }
  for (const [label, pattern] of check.forbidden) {
    if (pattern.test(source)) {
      console.error(`FAIL [${check.area}] ${label} remains in ${check.file}`);
      failures++;
    }
  }
}
if (failures) {
  console.error(`Sovereignty gate blocked: ${failures} prohibited active-path finding(s). This is an audit failure, not a deployment result.`);
  process.exitCode = 1;
} else {
  console.log('Sovereignty gate passed for the configured static checks. Live peer durability still requires separate end-to-end verification.');
}
