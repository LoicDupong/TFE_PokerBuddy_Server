import { DataTypes, Sequelize } from "sequelize";

/**
 * Journal d'audit du back-office : une ligne par action d'écriture d'un administrateur
 * (ou du script de promotion). Jamais modifié ni supprimé par l'application.
 * details : JSON non sensible uniquement (jamais de mot de passe, de jeton ni de tokenVersion).
 *
 * @param {Sequelize} sequelize
 */
export default function adminAuditLogModel(sequelize) {
    const AdminAuditLog = sequelize.define("AdminAuditLog", {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        actorId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: "users", key: "id" },
            // Les comptes ne sont jamais supprimés physiquement (anonymisés) : le journal reste rattaché
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        // ex. "user.disable", "user.role", "game.cancel"
        action: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        // ex. "user", "game"
        targetType: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        // STRING et pas UUID : la cible peut être une partie supprimée ou un objet d'un autre type
        targetId: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        details: {
            type: DataTypes.JSONB,
            allowNull: true,
        },
    }, {
        tableName: "admin_audit_logs",
        timestamps: true,
        updatedAt: false,
        // Index nommés : mêmes noms que la migration 0400, sync({ alter }) ne les recrée pas
        indexes: [
            { name: "admin_audit_logs_created_at", fields: ["createdAt"] },
            { name: "admin_audit_logs_target", fields: ["targetType", "targetId"] },
        ],
    });

    return AdminAuditLog;
}
