import SovereignMeshEngine from './sovereign-mesh-engine.mjs';

const storageDir =
  process.env.APEX_SOVEREIGN_STORAGE_DIR || '/srv/apex/se-x/projects';

const engine = new SovereignMeshEngine(storageDir);

async function main() {
  await engine.ready();

  console.log('[*] APEX STUDIO SOVEREIGN RUNTIME ONLINE');

  const result = await engine.dispatchAutonomousPayload({
    waveId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    action: 'SovereignPublish'
  });

  console.log('[RESULT]', JSON.stringify(result, null, 2));
  console.log(
    '[METRICS]',
    JSON.stringify(
      {
        records: engine.size,
        nextSequence: engine.nextSeq,
        storageDir: engine.storageDir,
        walFilePath: engine.walFilePath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[FATAL] Sovereign runtime failed:', error);
  process.exitCode = 1;
});
