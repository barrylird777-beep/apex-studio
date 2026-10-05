import pg from "pg";

const { Pool } = pg;

function assertIndex(plan, indexName) {
  if (!plan.includes(indexName)) {
    throw new Error(`INDEX BREACH: expected ${indexName} in planner output.\n${plan}`);
  }
}

export async function runPlannerBreaker() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL enable_seqscan = off");

    const similarity = await client.query(`
      EXPLAIN (COSTS OFF)
      SELECT id FROM bible_passages
       WHERE text % 'faithfulness'
       ORDER BY similarity(text, 'faithfulness') DESC
       LIMIT 50
    `);
    const similarityPlan = similarity.rows.map(row => row["QUERY PLAN"]).join("\n");
    assertIndex(similarityPlan, "bible_passages_text_trgm_idx");

    const partial = await client.query(`
      EXPLAIN (COSTS OFF)
      SELECT id FROM bible_passages
       WHERE text ILIKE '%righteous%'
       LIMIT 50
    `);
    const partialPlan = partial.rows.map(row => row["QUERY PLAN"]).join("\n");
    assertIndex(partialPlan, "bible_passages_text_trgm_idx");

    const reference = await client.query(`
      EXPLAIN (COSTS OFF)
      SELECT id FROM bible_passages
       WHERE reference % 'John 3:16'
       LIMIT 50
    `);
    const referencePlan = reference.rows.map(row => row["QUERY PLAN"]).join("\n");
    assertIndex(referencePlan, "bible_passages_reference_trgm_idx");

    await client.query("ROLLBACK");
    console.log("[BLACK-PEN] Bible trigram planner checks passed.");
    return { similarityPlan, partialPlan, referencePlan };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPlannerBreaker().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
