import db from "../models/index.js";
import { updateGameStatus } from "../utils/gameStatus.utils.js";
import { createNotification } from "../utils/notification.utils.js";

const resultsController = {

    createResults: async (req, res) => {
        const t = await db.sequelize.transaction();
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const { gameId } = req.params;
            const { results, finishedAt } = req.body;

            // Vérif game
            const game = await db.Game.findByPk(gameId, {
                include: [{ model: db.GamePlayer, as: "playerLinks" }]
            });
            if (!game) {
                await t.rollback();
                return res.status(404).json({ error: "Game not found" });
            }

            // Vérif host
            if (game.hostId !== req.user.id) {
                await t.rollback();
                return res.status(403).json({ error: "Only the host can submit results" });
            }

            // Vérif statut
            if (game.status === "finished") {
                await t.rollback();
                return res.status(400).json({ error: "Game already finished" });
            }

            // Vérif données envoyées
            if (!Array.isArray(results) || results.length === 0) {
                await t.rollback();
                return res.status(400).json({ error: "Results must be a non-empty array" });
            }

            // 🔹 Supprimer anciens résultats
            await db.GameResult.destroy({ where: { gameId: game.id }, transaction: t });

            // 🔹 Enregistrer les nouveaux résultats
            const createdResults = [];
            for (const r of results) {
                const player = game.playerLinks.find(p => p.id === r.gamePlayerId);
                if (!player) {
                    await t.rollback();
                    return res.status(400).json({ error: `Invalid gamePlayerId: ${r.gamePlayerId}` });
                }

                const result = await db.GameResult.create({
                    gameId: game.id,
                    gamePlayerId: r.gamePlayerId,
                    rank: r.rank,
                    prize: r.prize ?? 0
                }, { transaction: t });

                createdResults.push(result);
            }

            // 🔹 Trier avant de renvoyer
            createdResults.sort((a, b) => a.rank - b.rank);

            // 🔹 Terminer la game
            await game.update({
                status: "finished",
                dateEnd: finishedAt ? new Date(finishedAt) : new Date(),
            }, { transaction: t });

            await t.commit();

            // Non-blocking notifications — must be after commit so game.id is stable
            const notifyPromises = game.playerLinks
                .filter(p => p.userId && p.userId !== req.user.id)
                .map(p => createNotification(p.userId, 'game_result', `Results for "${game.name}" are in`, game.id));
            await Promise.all(notifyPromises);

            return res.status(201).json({
                message: "Results saved",
                results: createdResults
            });

        } catch (error) {
            await t.rollback();
            console.error("CreateResults error:", error);
            return res.status(500).json({ error: "Error saving results" });
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
                        attributes: ["id", "guestName", "status"],
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
