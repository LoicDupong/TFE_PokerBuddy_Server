import { addEnumValue } from "./helpers.js";

// Notification envoyée aux invités quand l'hôte d'une partie non terminée supprime son compte.
// ADD VALUE IF NOT EXISTS : idempotent (en dev, sync({ alter }) a pu ajouter la valeur avant).
export async function up({ queryInterface, transaction }) {
    await addEnumValue(queryInterface, "enum_notifications_type", "game_cancelled", transaction);
}
