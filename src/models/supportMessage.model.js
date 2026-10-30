import { DataTypes, Sequelize } from "sequelize";

/**
 * Message d'un ticket : écrit par l'utilisateur ou par le staff (isStaff).
 * @param {Sequelize} sequelize
 */
export default function supportMessageModel(sequelize) {
    return sequelize.define("SupportMessage", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        ticketId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: "support_tickets", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        authorId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: "users", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        isStaff: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        body: { type: DataTypes.TEXT, allowNull: false },
    }, {
        tableName: "support_messages",
        timestamps: true,
        updatedAt: false,
        indexes: [
            { name: "support_messages_ticket_id_created_at", fields: ["ticketId", "createdAt"] },
        ],
    });
}
