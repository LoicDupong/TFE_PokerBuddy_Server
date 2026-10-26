import db from "../models/index.js";
import { Op } from "sequelize";

/**
 * Creates a notification silently. Never throws — a notification failure must
 * never break the main action that triggered it.
 */
export const createNotification = async (userId, type, message, referenceId = null) => {
    try {
        await db.Notification.create({ userId, type, message, referenceId });
    } catch (err) {
        console.error("Notification creation failed (non-blocking):", err);
    }
};

export const triggerResultReminders = async (userId) => {
    try {
        const now = new Date();
        const pastUnfinishedGames = await db.Game.findAll({
            where: {
                hostId: userId,
                status: { [Op.in]: ["pending", "active"] },
                dateStart: { [Op.lt]: now },
            },
        });

        if (pastUnfinishedGames.length === 0) return;

        // Une seule requête pour les rappels existants (au lieu d'une par partie)
        const existing = await db.Notification.findAll({
            where: {
                userId,
                type: "game_result_reminder",
                referenceId: { [Op.in]: pastUnfinishedGames.map((g) => g.id) },
            },
            attributes: ["referenceId"],
        });
        const alreadyReminded = new Set(existing.map((n) => n.referenceId));

        const missing = pastUnfinishedGames.filter((g) => !alreadyReminded.has(g.id));
        if (missing.length) {
            await db.Notification.bulkCreate(missing.map((game) => ({
                userId,
                type: "game_result_reminder",
                message: `Don't forget to submit results for "${game.name}"`,
                referenceId: game.id,
            })));
        }
    } catch (err) {
        console.error("triggerResultReminders failed (non-blocking):", err);
    }
};
