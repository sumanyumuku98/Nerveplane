import { defineConfig } from "drizzle-kit";
import { DB_PATH } from "./src/config.ts";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/storage/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: DB_PATH },
});
