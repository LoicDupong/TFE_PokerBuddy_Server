import { addColumnIfMissing } from "./helpers.js";

// Colonnes partagées par l'auth (reset, suppression) et le back-office (rôle, désactivation)
export async function up({ queryInterface, Sequelize, transaction }) {
    await addColumnIfMissing(queryInterface, "users", "role", {
        type: Sequelize.ENUM("user", "admin"),
        allowNull: false,
        defaultValue: "user",
    }, transaction);
    await addColumnIfMissing(queryInterface, "users", "tokenVersion", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
    }, transaction);
    await addColumnIfMissing(queryInterface, "users", "disabledAt", { type: Sequelize.DATE, allowNull: true }, transaction);
    await addColumnIfMissing(queryInterface, "users", "deletedAt", { type: Sequelize.DATE, allowNull: true }, transaction);
    await addColumnIfMissing(queryInterface, "users", "passwordResetTokenHash", { type: Sequelize.STRING, allowNull: true }, transaction);
    await addColumnIfMissing(queryInterface, "users", "passwordResetExpiresAt", { type: Sequelize.DATE, allowNull: true }, transaction);

    // Comptes déjà supprimés avant cette colonne (anonymisés en "deleted_<id>")
    await queryInterface.sequelize.query(
        `UPDATE users SET "deletedAt" = "updatedAt" WHERE "deletedAt" IS NULL AND username LIKE 'deleted\\_%'`,
        { transaction }
    );
}
