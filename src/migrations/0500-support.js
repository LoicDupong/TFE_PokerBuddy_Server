import { addEnumValue, createTableIfMissing } from "./helpers.js";

// Support (agent G) : tickets d'aide et fil de messages.
// Les types ENUM sont créés avec la table (createTable) ; en dev, sync({ alter }) a pu les créer avant.

async function addIndexIfMissing(queryInterface, table, name, fields, transaction) {
    const [rows] = await queryInterface.sequelize.query(
        "SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :name",
        { replacements: { name }, transaction }
    );
    if (rows.length) return;
    await queryInterface.addIndex(table, fields, { name, transaction });
}

export async function up({ queryInterface, Sequelize, transaction }) {
    await createTableIfMissing(queryInterface, "support_tickets", {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        userId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "users", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        category: { type: Sequelize.ENUM("bug", "account", "game", "suggestion", "other"), allowNull: false },
        subject: { type: Sequelize.STRING(120), allowNull: false },
        status: { type: Sequelize.ENUM("new", "in_progress", "resolved"), allowNull: false, defaultValue: "new" },
        lastMessageAt: { type: Sequelize.DATE, allowNull: false },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
    }, transaction);

    await createTableIfMissing(queryInterface, "support_messages", {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        ticketId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "support_tickets", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        authorId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "users", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        isStaff: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        body: { type: Sequelize.TEXT, allowNull: false },
        createdAt: { type: Sequelize.DATE, allowNull: false },
    }, transaction);

    await addIndexIfMissing(queryInterface, "support_tickets", "support_tickets_user_id_last_message_at", ["userId", "lastMessageAt"], transaction);
    await addIndexIfMissing(queryInterface, "support_tickets", "support_tickets_status_last_message_at", ["status", "lastMessageAt"], transaction);
    await addIndexIfMissing(queryInterface, "support_messages", "support_messages_ticket_id_created_at", ["ticketId", "createdAt"], transaction);

    // Notification envoyée à l'auteur quand le support répond
    await addEnumValue(queryInterface, "enum_notifications_type", "support_reply", transaction);
}
