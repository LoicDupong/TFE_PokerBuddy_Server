import db from "../models/index.js";

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
