// Applique les migrations de src/migrations/ dans l'ordre de leur nom (NNNN-description.js).
// Chaque migration n'est jouée qu'une fois : son nom est enregistré dans la table schema_migrations.
// Dev : npm run migrate (.env.local) ; prod : npm run migrate:prod, après une sauvegarde de la base.
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { Sequelize } from "sequelize";
import db from "../models/index.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = /^\d{4}-[\w-]+\.js$/;

const { sequelize } = db;
const queryInterface = sequelize.getQueryInterface();

try {
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name VARCHAR(255) PRIMARY KEY,
            "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    const [rows] = await sequelize.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.name));

    const files = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) console.log("✅ Database schema is up to date");

    for (const file of pending) {
        const migration = await import(pathToFileURL(path.join(dir, file)).href);
        console.log(`➡️  ${file}`);

        // Postgres accepte le DDL en transaction ; une migration peut s'en passer (export const transaction = false)
        if (migration.transaction === false) {
            await migration.up({ queryInterface, Sequelize, sequelize });
            await sequelize.query("INSERT INTO schema_migrations (name) VALUES (:file)", { replacements: { file } });
        } else {
            await sequelize.transaction(async (transaction) => {
                await migration.up({ queryInterface, Sequelize, sequelize, transaction });
                await sequelize.query("INSERT INTO schema_migrations (name) VALUES (:file)", { replacements: { file }, transaction });
            });
        }
        console.log(`✅ ${file}`);
    }
} catch (error) {
    console.error("❌ Migration failed:", error);
    process.exitCode = 1;
} finally {
    await sequelize.close();
}
