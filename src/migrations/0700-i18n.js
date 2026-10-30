import { addColumnIfMissing } from "./helpers.js";

// Traduction FR/EN (agent J1) : langue préférée du compte (emails, notifications) et paramètres
// structurés des notifications (le client les rend dans la langue de l'utilisateur ; `message` reste le repli anglais).
export async function up({ queryInterface, Sequelize, transaction }) {
    await addColumnIfMissing(queryInterface, "users", "locale", {
        type: Sequelize.STRING(5),
        allowNull: false,
        defaultValue: "en",
    }, transaction);
    await addColumnIfMissing(queryInterface, "notifications", "params", {
        type: Sequelize.JSONB,
        allowNull: true,
    }, transaction);
}

export async function down({ queryInterface, transaction }) {
    await queryInterface.removeColumn("notifications", "params", { transaction });
    await queryInterface.removeColumn("users", "locale", { transaction });
}
