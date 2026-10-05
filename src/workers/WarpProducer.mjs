import pg from "pg";
import { EpisodePipeline } from "../pipelines/episode-pipeline.mjs";
import crypto from "node:crypto";

const { Pool } = pg;

function parseArgs(argv) {
  const books = [];
  let maxChapter = 3;
  let concurrency = 8;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--books") {
      books.push(...String(argv[++i] || "").split(",").map((v) => v.trim()).filter(Boolean));
    } else if (arg === "--max-chapter") {
      maxChapter = Math.max(1, Math.min(300, Number(argv[++i]) || 3));
    } else if (arg === "--concurrency") {
      concurrency = Math.max(1, Math.min(32, Number(argv[++i]) || 8));
    }
  }

  return {
    books: books.length ? books : ["Genesis", "Exodus", "John"],
    maxChapter,
    concurrency
  };
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => runner())
  );
  return results;
}

export class WarpProducer {
  constructor(pool, { concurrency = 8, maxChapter = 3 } = {}) {
    if (!pool) throw new TypeError("WarpProducer requires PostgreSQL");
    this.pool = pool;
    this.pipeline = new EpisodePipeline(pool);
    this.concurrency = Math.max(1, Math.min(32, Number(concurrency) || 8));
    this.maxChapter = Math.max(1, Math.min(300, Number(maxChapter) || 3));
  }

  async feedBatch(books) {
    const normalizedBooks = [...new Set(
      books.map((book) => String(book || "").trim()).filter(Boolean)
    )];
    const work = normalizedBooks.flatMap((book) =>
      Array.from({ length: this.maxChapter }, (_, i) => ({
        book,
        chapter: i + 1
      }))
    );

    console.log(
      `[WARP PRODUCER] Dispatching ${work.length} episode pipelines across ${this.concurrency} producers.`
    );

    const traceRoot = `warp-${crypto.randomUUID()}`;
    const results = await runPool(work, this.concurrency, async ({ book, chapter }) => {
      const traceId = `${traceRoot}-${book.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${chapter}`;
      return this.pipeline.igniteEpisode(book, chapter, "full", traceId);
    });

    const jobs = results.reduce((sum, result) => sum + Number(result?.jobs || 0), 0);
    return {
      books: normalizedBooks,
      episodes: results.length,
      workerTasks: jobs,
      episodeIds: results.map((result) => result.episodeId)
    };
  }
}

const isDirectRun = process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  const { books, maxChapter, concurrency } = parseArgs(process.argv.slice(2));
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Math.max(5, Math.min(10, Number(process.env.APEX_WORKER_DB_POOL_MAX || 8)))
  });

  try {
    const producer = new WarpProducer(pool, { concurrency, maxChapter });
    const summary = await producer.feedBatch(books);
    console.log("[WARP PRODUCER] COMPLETE", JSON.stringify(summary));
  } catch (error) {
    console.error("[WARP PRODUCER] FAILED", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
