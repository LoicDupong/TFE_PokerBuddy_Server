import db from "../models/index.js";

const inviteController = {
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

            // Cas 1 : on invite un user existant
            if (userId) {
                const existingUser = await db.User.findByPk(userId);
                if (!existingUser) {
                    return res.status(404).json({ error: "User not found" });
                }

                // Vérifie si déjà invité
                const alreadyInvited = await db.GamePlayer.findOne({ where: { gameId, userId } });
                if (alreadyInvited) {
                    return res.status(400).json({ error: "User already invited" });
                }

                const invited = await db.GamePlayer.create({ gameId, userId, isConfirmed: false });
                return res.status(201).json({ message: "User invited", invited });
            }

            // Cas 2 : on invite un joueur externe
            if (guestName) {
                const invited = await db.GamePlayer.create({ gameId, guestName, isConfirmed: false });
                return res.status(201).json({ message: "Guest invited", invited });
            }

            // Le host ne peut pas s'inviter lui-même
            if (userId === req.user.id) {
                return res.status(400).json({ error: "Host is already part of the game" });
            }

            // Vérifie si le joueur est déjà invitéé
            const alreadyInvitedGuest = await db.GamePlayer.findOne({ where: { gameId, guestName } });
            if (alreadyInvitedGuest) {
                return res.status(400).json({ error: "Guest already invited" });
            }

            return res.status(400).json({ error: "You must provide either userId or guestName" });

        } catch (error) {
            console.error("Invite error:", error);
            return res.status(500).json({ error: "Error inviting player" });
        }
    },
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
                    { model: db.User, as: 'user', attributes: ['id', 'username', 'email'] }
                ]
            });

            res.status(200).json({ invites });
        } catch (error) {
            console.error("Get invites error:", error);
            return res.status(500).json({ error: "Error fetching invites" });
        }
    },

    confirmInvite: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const { gameId } = req.params;

            // Vérifie que le jeu existe et n'est pas fini
            const game = await db.Game.findByPk(gameId);
            if (!game) return res.status(404).json({ error: "Game not found" });
            if (game.status === "finished") {
                return res.status(400).json({ error: "Cannot confirm invite for a finished game" });
            }


            // On cherche le lien GamePlayer
            const invite = await db.GamePlayer.findOne({
                where: { gameId, userId: req.user.id }
            });

            if (!invite) {
                return res.status(404).json({ error: "Invitation not found" });
            }

            if (invite.isConfirmed) {
                return res.status(400).json({ error: "Invitation already confirmed" });
            }

            await invite.update({ isConfirmed: true });

            return res.status(200).json({ message: "Invitation confirmed", invite });
        } catch (error) {
            console.error("Confirm invite error:", error);
            return res.status(500).json({ error: "Error confirming invitation" });
        }

    }
};

export default inviteController;