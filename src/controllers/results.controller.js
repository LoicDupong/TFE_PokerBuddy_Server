import db from "../models/index.js";
import { updateGameStatus } from "../utils/gameStatus.utils.js";

const resultsController = {

    createResults: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const { gameId } = req.params;
            const { results } = req.body;

            // Vérif game
            const game = await db.Game.findByPk(gameId, {
                include: [{ model: db.GamePlayer, as: "playerLinks" }]
            });
            if (!game) return res.status(404).json({ error: "Game not found" });

            // Vérif host
            if (game.hostId !== req.user.id) {
                return res.status(403).json({ error: "Only the host can submit results" });
            }

            // Vérif statut
            if (game.status === "finished") {
                return res.status(400).json({ error: "Game already finished" });
            }

            // Vérif données envoyées
            if (!Array.isArray(results) || results.length === 0) {
                return res.status(400).json({ error: "Results must be a non-empty array" });
            }

            // Enregistre les résultats
            const createdResults = [];
            for (const r of results) {
                const player = game.playerLinks.find(p => p.id === r.gamePlayerId);
                if (!player) {
                    return res.status(400).json({ error: `Invalid gamePlayerId: ${r.gamePlayerId}` });
                }

                const result = await db.GameResult.create({
                    gameId: game.id,
                    gamePlayerId: r.gamePlayerId,
                    rank: r.rank,
                    prize: r.prize ?? 0
                });

                createdResults.push(result);
            }

            // Termine la game
            await game.update({ status: "finished", dateEnd: new Date() });

            res.status(201).json({ message: "Results saved", results: createdResults });
        } catch (error) {
            console.error("CreateResults error:", error);
            res.status(500).json({ error: "Error saving results" });
        }
    },

    getResults: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const { gameId } = req.params;

            const game = await db.Game.findByPk(gameId, {
                attributes: ["id", "name", "status", "dateStart", "dateEnd"],
            });
            if (!game) return res.status(404).json({ error: "Game not found" });

            const results = await db.GameResult.findAll({
                where: { gameId },
                include: [
                    {
                        model: db.GamePlayer,
                        as: "player",
                        attributes: ["id", "guestName", "isConfirmed"],
                        include: [
                            { model: db.User, as: "user", attributes: ["id", "username", "email"] },
                        ],
                    },
                ],
                order: [["rank", "ASC"]],
            });

            return res.status(200).json({ game, results });
        } catch (error) {
            console.error("getGameResults error:", error);
            return res.status(500).json({ error: "Error fetching game results" });
        }
    },
};

export default resultsController;
