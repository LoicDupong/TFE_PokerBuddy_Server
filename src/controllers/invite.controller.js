import db from "../models/index.js";

const inviteController = {
    // 🔹 Inviter un user ou guest
    invitePlayer: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const { gameId } = req.params;
            const { userId, guestName } = req.body;

            const game = await db.Game.findByPk(gameId);
            if (!game) {
                return res.status(404).json({ error: "Game not found" });
            }

            if (game.hostId !== req.user.id) {
                return res.status(403).json({ error: "Only the host can invite players" });
            }

            // Cas 1 : user existant
            if (userId) {
                const existingUser = await db.User.findByPk(userId);
                if (!existingUser) {
                    return res.status(404).json({ error: "User not found" });
                }

                const alreadyInvited = await db.GamePlayer.findOne({ where: { gameId, userId } });
                if (alreadyInvited) {
                    return res.status(400).json({ error: "User already invited" });
                }

                const invited = await db.GamePlayer.create({ gameId, userId, status: "pending" });
                return res.status(201).json({ message: "User invited", invited });
            }

            // Cas 2 : guest
            if (guestName) {
                const alreadyInvitedGuest = await db.GamePlayer.findOne({ where: { gameId, guestName } });
                if (alreadyInvitedGuest) {
                    return res.status(400).json({ error: "Guest already invited" });
                }

                const invited = await db.GamePlayer.create({ gameId, guestName, status: "pending" });
                return res.status(201).json({ message: "Guest invited", invited });
            }

            return res.status(400).json({ error: "You must provide either userId or guestName" });
        } catch (error) {
            console.error("Invite error:", error);
            return res.status(500).json({ error: "Error inviting player" });
        }
    },

    // 🔹 Liste des invites d'une game
    getInvitesList: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const { gameId } = req.params;
            const game = await db.Game.findByPk(gameId);
            if (!game) {
                return res.status(404).json({ error: "Game not found" });
            }

            const invites = await db.GamePlayer.findAll({
                where: { gameId },
                include: [
                    { model: db.User, as: "user", attributes: ["id", "username", "email"] },
                ],
            });

            res.status(200).json({
                invites: invites.map((i) => ({
                    id: i.id,
                    type: i.user ? "user" : "guest",
                    username: i.user?.username || i.guestName,
                    email: i.user?.email || (i.guestName?.includes("@") ? i.guestName : null),
                    status: i.status,
                })),
            });
        } catch (error) {
            console.error("Get invites error:", error);
            return res.status(500).json({ error: "Error fetching invites" });
        }
    },

    // 🔹 Invites du user connecté (notifications)
    getMyInvites: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const invites = await db.GamePlayer.findAll({
                where: { userId: req.user.id, status: "pending" },
                include: [
                    {
                        model: db.Game,
                        as: "game",
                        attributes: ["id", "name", "dateStart", "location"],
                        include: [{ model: db.User, as: "host", attributes: ["id", "username"] }],
                    },
                ],
            });

            res.status(200).json({
                invites: invites.map((i) => ({
                    inviteId: i.id,
                    gameId: i.game.id,
                    gameName: i.game.name,
                    host: i.game.host.username,
                    dateStart: i.game.dateStart,
                    location: i.game.location,
                    status: i.status,
                })),
            });
        } catch (error) {
            console.error("Get my invites error:", error);
            return res.status(500).json({ error: "Error fetching my invites" });
        }
    },

    // 🔹 Répondre à une invite (accept/refuse)
    respondInvite: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const { inviteId } = req.params;
            const { status } = req.body; // "accepted" ou "refused"

            if (!["accepted", "refused"].includes(status)) {
                return res.status(400).json({ error: "Invalid status" });
            }

            const invite = await db.GamePlayer.findByPk(inviteId, {
                include: [{ model: db.Game, as: "game" }],
            });

            if (!invite) return res.status(404).json({ error: "Invite not found" });
            if (invite.userId !== req.user.id) {
                return res.status(403).json({ error: "Not your invite" });
            }
            if (invite.game.status === "finished") {
                return res.status(400).json({ error: "Game already finished" });
            }

            await invite.update({ status });
            return res.status(200).json({ message: "Invite updated", invite });
        } catch (error) {
            console.error("Respond invite error:", error);
            return res.status(500).json({ error: "Error responding to invite" });
        }
    },
};

export default inviteController;
