import { DataTypes, Sequelize } from "sequelize";

/**
 * Demande d'aide d'un utilisateur (fil de discussion dans support_messages).
 * @param {Sequelize} sequelize
 */
export default function supportTicketModel(sequelize) {
    return sequelize.define("SupportTicket", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        userId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: "users", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        category: { type: DataTypes.ENUM("bug", "account", "game", "suggestion", "other"), allowNull: false },
        subject: { type: DataTypes.STRING(120), allowNull: false },
        status: { type: DataTypes.ENUM("new", "in_progress", "resolved"), allowNull: false, defaultValue: "new" },
        // Date du dernier message : sert au tri des listes
        lastMessageAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
        tableName: "support_tickets",
        timestamps: true,
        // Mêmes noms que la migration 0500 (sync({ alter }) ne les duplique pas)
        indexes: [
            { name: "support_tickets_user_id_last_message_at", fields: ["userId", "lastMessageAt"] },
            { name: "support_tickets_status_last_message_at", fields: ["status", "lastMessageAt"] },
        ],
    });
}
