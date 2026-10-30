import { createTableIfMissing } from "./helpers.js";

// Back-office (agent F) : journal des actions d'administration (models/adminAuditLog.model.js)

async function addIndexIfMissing(queryInterface, table, name, fields, transaction) {
    const [rows] = await queryInterface.sequelize.query(
        "SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :name",
        { replacements: { name }, transaction }
    );
    if (rows.length) return;
    await queryInterface.addIndex(table, fields, { name, transaction });
}

export async function up({ queryInterface, Sequelize, transaction }) {
    await createTableIfMissing(queryInterface, "admin_audit_logs", {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        actorId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "users", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        action: { type: Sequelize.STRING, allowNull: false },
        targetType: { type: Sequelize.STRING, allowNull: false },
        targetId: { type: Sequelize.STRING, allowNull: true },
        details: { type: Sequelize.JSONB, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
    }, transaction);

    await addIndexIfMissing(queryInterface, "admin_audit_logs", "admin_audit_logs_created_at", ["createdAt"], transaction);
    await addIndexIfMissing(queryInterface, "admin_audit_logs", "admin_audit_logs_target", ["targetType", "targetId"], transaction);
}
