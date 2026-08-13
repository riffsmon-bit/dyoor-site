import { getEnv } from "../src/config/env.js";
import { openMigratedDatabase } from "../src/database/database.js";

const database = openMigratedDatabase(getEnv().DATABASE_PATH);
const rows = database.prepare("SELECT version, name, applied_at FROM schema_migrations").all();
database.close();
console.log(`Database ready. Applied migrations: ${rows.length}`);
