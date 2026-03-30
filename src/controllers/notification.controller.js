import db from "../models/index.js";

const notificationController = {
    getMyNotifications: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const notifications = await db.Notification.findAll({
                where: { userId: req.user.id },
                order: [['createdAt', 'DESC']],
                limit: 30,
            });

            const unreadCount = notifications.filter(n => !n.read).length;

            return res.status(200).json({ notifications, unreadCount });
        } catch (error) {
            console.error("getMyNotifications error:", error);
            return res.status(500).json({ error: "Error fetching notifications" });
        }
    },

    markAllRead: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            await db.Notification.update(
                { read: true },
                { where: { userId: req.user.id, read: false } }
            );

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error("markAllRead error:", error);
            return res.status(500).json({ error: "Error marking notifications as read" });
        }
    },
};

export default notificationController;
