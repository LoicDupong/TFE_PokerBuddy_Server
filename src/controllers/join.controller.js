import db from "../models/index.js";

const joinController = {
    joinByToken: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const { token } = req.params;

            const game = await db.Game.findOne({
                where: { inviteCode: token },
                include: [{ model: db.GamePlayer, as: "playerLinks" }],
            });

            if (!game) return res.status(404).json({ error: "Invalid or disabled invite link" });
            if (game.status !== "pending") return res.status(400).json({ error: "This game has already started or ended" });
            if (req.user.id === game.hostId) return res.status(400).json({ error: "You are the host of this game" });

            // Avant le contrôle "complet" : un joueur déjà confirmé n'est pas refusé
            const existing = game.playerLinks.find(p => p.userId === req.user.id);
            if (existing?.status === "accepted") {
                return res.status(200).json({ status: "already_accepted", gameId: game.id, gameName: game.name });
            }

            // Places = joueurs confirmés (l'hôte compris) ; une invitation sans réponse ne prend pas de place
            if (game.maxPlayers) {
                const acceptedCount = game.playerLinks.filter(p => p.status === "accepted").length;
                if (acceptedCount >= game.maxPlayers) {
                    return res.status(400).json({ error: "This game is full" });
                }
            }

            if (existing) {
                await existing.update({ status: "accepted" });
                return res.status(200).json({ status: "accepted", gameId: game.id, gameName: game.name });
            }

            await db.GamePlayer.create({
                gameId: game.id,
                userId: req.user.id,
                userName: req.user.username,
                status: "accepted",
            });

            return res.status(201).json({ status: "joined", gameId: game.id, gameName: game.name });

        } catch (error) {
            console.error("joinByToken error:", error);
            return res.status(500).json({ error: "Error joining game" });
        }
    },
};

export default joinController;
