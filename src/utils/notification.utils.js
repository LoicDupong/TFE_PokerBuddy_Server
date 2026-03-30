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

        for (const game of pastUnfinishedGames) {
            const existing = await db.Notification.findOne({
                where: {
                    userId,
                    type: "game_result_reminder",
                    referenceId: game.id,
                },
            });
            if (!existing) {
                await db.Notification.create({
                    userId,
                    type: "game_result_reminder",
                    message: `Don't forget to submit results for "${game.name}"`,
                    referenceId: game.id,
                });
            }
        }
    } catch (err) {
        console.error("triggerResultReminders failed (non-blocking):", err);
    }
};
