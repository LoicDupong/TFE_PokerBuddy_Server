import { createTableIfMissing } from "./helpers.js";

// Analytics sans cookie (agent H) : compteurs de pages vues agrégés par jour.
// Aucune IP, aucun identifiant de visiteur, aucune ligne par visite : seulement un compteur par
// (jour, page normalisée, site référent). Clé primaire composite = clé unique de l'upsert.
export async function up({ queryInterface, Sequelize, transaction }) {
    await createTableIfMissing(queryInterface, "page_views_daily", {
        day: { type: Sequelize.DATEONLY, allowNull: false, primaryKey: true },
        path: { type: Sequelize.STRING(200), allowNull: false, primaryKey: true },
        referrerHost: { type: Sequelize.STRING(100), allowNull: false, defaultValue: "", primaryKey: true },
        views: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    }, transaction);
}
