import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required for PostgreSQL Drizzle commands.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle-pg",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
