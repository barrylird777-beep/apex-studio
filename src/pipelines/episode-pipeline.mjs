import crypto from "node:crypto";

function bookName(book) {
  const value = String(book || "").trim();
  if (!/^\p{L}[\p{L}\p{N} .'-]{0,79}$/u.test(value)) throw new Error("Invalid Bible book name");
  return value;
}
function chapterNumber(chapter) {
  const value = Number(chapter);
  if (!Number.isInteger(value) || value < 1 || value > 300) throw new Error("Invalid chapter");
  return value;
}
function verseRange(verses) {
  const value = String(verses || "full").trim();
  if (!/^(?:full|\d{1,3}(?:-\d{1,3})?)$/i.test(value)) throw new Error("Invalid verse range");
  return value;
}

const STAGES = [
  ["graph-expansion", "theological", 1],
  ["graph-expansion", "historical", 2],
  ["episode-script-generation", "script", 3],
];

export class EpisodePipeline {
  constructor(pool) {
    if (!pool) throw new TypeError("EpisodePipeline requires PostgreSQL");
    this.pool = pool;
  }

  async igniteEpisode(book, chapter, verses = "full", traceId = null) {
    const b = bookName(book);
    const c = chapterNumber(chapter);
    const v = verseRange(verses);
    const episodeId = crypto.randomUUID();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO apex_episode_pipelines (id,book,chapter,verses,status) VALUES ($1,$2,$3,$4,'queued')",
        [episodeId, b, c, v]
      );

      const stageRows = STAGES.map(([role, stage, order]) => [
        crypto.randomUUID(),
        role,
        JSON.stringify({
          type: "episode-stage",
          episodeId,
          book: b,
          chapter: c,
          verses: v,
          stage,
          order,
          ...(role === "graph-expansion" ? { expansionType: stage, type: stage } : {})
        }),
        `episode:${episodeId}:${stage}`,
        traceId ? String(traceId).slice(0, 255) : null
      ]);
      await client.query(
        `INSERT INTO apex_worker_tasks
          (id,worker_id,role,task,payload,max_attempts,dedupe_key,trace_id)
         SELECT x.id, 'episode-pipeline', x.role, x.role, x.payload::jsonb, 5, x.dedupe_key, x.trace_id
           FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])
             AS x(id, role, payload, dedupe_key, trace_id)
         ON CONFLICT DO NOTHING`,
        [
          stageRows.map(row => row[0]),
          stageRows.map(row => row[1]),
          stageRows.map(row => row[2]),
          stageRows.map(row => row[3]),
          stageRows.map(row => row[4])
        ]
      );

      await client.query("COMMIT");
      return { episodeId, stages: STAGES.map(([role, stage, order]) => ({ role, stage, order })) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
