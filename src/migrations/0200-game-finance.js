import { addColumnIfMissing, createTableIfMissing } from "./helpers.js";

// Finances de partie (agent C) : rebuys, add-ons et PKO.
// - games : prix du rebuy et réglages PKO (désactivé par défaut : les parties existantes restent classiques)
// - game_results : montants en centimes des nouvelles parties (null pour les anciennes → stats inchangées)
// - game_finance_ops : opérations (événements) rejouées par utils/finance.utils.js

async function constraintExists(queryInterface, name, transaction) {
    const [rows] = await queryInterface.sequelize.query(
        "SELECT 1 FROM pg_constraint WHERE conname = :name",
        { replacements: { name }, transaction }
    );
    return rows.length > 0;
}

// CHECK ajouté seulement s'il n'existe pas (sync({ alter }) ne crée pas ces contraintes)
async function addCheckIfMissing(queryInterface, table, name, expression, transaction) {
    if (await constraintExists(queryInterface, name, transaction)) return;
    await queryInterface.sequelize.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expression})`,
        { transaction }
    );
}

async function addIndexIfMissing(queryInterface, table, name, fields, transaction, unique = false) {
    const [rows] = await queryInterface.sequelize.query(
        "SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :name",
        { replacements: { name }, transaction }
    );
    if (rows.length) return;
    await queryInterface.addIndex(table, fields, { name, unique, transaction });
}

export async function up({ queryInterface, Sequelize, transaction }) {
    // ── games ──
    await addColumnIfMissing(queryInterface, "games", "rebuyAmountCents", { type: Sequelize.INTEGER, allowNull: true }, transaction);
    await addColumnIfMissing(queryInterface, "games", "pkoEnabled", {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    }, transaction);
    await addColumnIfMissing(queryInterface, "games", "pkoBountyPercent", {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 50,
    }, transaction);
    await addColumnIfMissing(queryInterface, "games", "pkoCashPercent", {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 50,
    }, transaction);
    await addCheckIfMissing(queryInterface, "games", "games_rebuy_amount_cents_check",
        `"rebuyAmountCents" IS NULL OR "rebuyAmountCents" >= 0`, transaction);
    await addCheckIfMissing(queryInterface, "games", "games_pko_percents_check",
        `"pkoBountyPercent" BETWEEN 0 AND 100 AND "pkoCashPercent" BETWEEN 0 AND 100`, transaction);

    // ── game_results ──
    for (const column of ["prizeCents", "bountyCents", "investedCents"]) {
        await addColumnIfMissing(queryInterface, "game_results", column, { type: Sequelize.INTEGER, allowNull: true }, transaction);
    }

    // ── game_finance_ops ──
    await createTableIfMissing(queryInterface, "game_finance_ops", {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        gameId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "games", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        opId: { type: Sequelize.UUID, allowNull: false },
        seq: { type: Sequelize.INTEGER, allowNull: false },
        type: { type: Sequelize.ENUM("buyin", "rebuy", "addon", "knockout"), allowNull: false },
        gamePlayerId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "game_players", key: "id" },
            onDelete: "NO ACTION",
            onUpdate: "CASCADE",
        },
        amountCents: { type: Sequelize.INTEGER, allowNull: true },
        chips: { type: Sequelize.INTEGER, allowNull: true },
        eliminatorIds: { type: Sequelize.JSONB, allowNull: true },
        correctsId: { type: Sequelize.UUID, allowNull: true },
        voidedAt: { type: Sequelize.DATE, allowNull: true },
        createdById: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: "users", key: "id" },
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
        },
        voidedById: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: "users", key: "id" },
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
        },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
    }, transaction);

    // Idempotence des opérations : un opId (UUID généré par le client) n'existe qu'une fois
    await addIndexIfMissing(queryInterface, "game_finance_ops", "game_finance_ops_op_id_unique", ["opId"], transaction, true);
    await addIndexIfMissing(queryInterface, "game_finance_ops", "game_finance_ops_game_id_seq", ["gameId", "seq"], transaction);
    await addIndexIfMissing(queryInterface, "game_finance_ops", "game_finance_ops_game_player_id", ["gamePlayerId"], transaction);

    // Garde-fous en base, en plus de la validation de l'API : montants jamais négatifs,
    // une entrée a un montant, un knockout a des éliminateurs
    await addCheckIfMissing(queryInterface, "game_finance_ops", "game_finance_ops_amount_cents_check",
        `"amountCents" IS NULL OR "amountCents" >= 0`, transaction);
    await addCheckIfMissing(queryInterface, "game_finance_ops", "game_finance_ops_chips_check",
        `"chips" IS NULL OR "chips" >= 0`, transaction);
    await addCheckIfMissing(queryInterface, "game_finance_ops", "game_finance_ops_shape_check",
        `("type" = 'knockout' AND "eliminatorIds" IS NOT NULL AND "amountCents" IS NULL)
         OR ("type" <> 'knockout' AND "amountCents" IS NOT NULL AND "eliminatorIds" IS NULL)`, transaction);
}
