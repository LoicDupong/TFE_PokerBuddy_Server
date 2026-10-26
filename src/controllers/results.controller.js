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

            // Vérif statut : une partie "finished" sans résultats (ancien passage auto après 24 h)
            // peut encore recevoir ses résultats
            const existingResults = await db.GameResult.count({ where: { gameId: game.id } });
            if (game.status === "finished" && existingResults > 0) {
                await t.rollback();
                return res.status(400).json({ error: "Results already submitted for this game" });
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
            let rank = 1;
            for (const r of results) {
                const player = game.playerLinks.find(p => p.id === r.gamePlayerId);

                let resolvedGamePlayerId;
                if (player) {
                    resolvedGamePlayerId = player.id;
                } else {
                    // Unknown ID — walk-in player added in the manager, not in the original invite list
                    const name = r.guestName?.trim().replace(/\s+/g, " ");
                    if (!name) {
                        console.warn(`createResults: unknown gamePlayerId ${r.gamePlayerId} with no guestName, skipping`);
                        continue;
                    }

                    // Find-or-create to handle duplicate names safely
                    const [walkin] = await db.GamePlayer.findOrCreate({
                        where: { gameId: game.id, guestName: name },
                        defaults: { gameId: game.id, guestName: name, status: "accepted" },
                        transaction: t,
                    });
                    resolvedGamePlayerId = walkin.id;
                }

                const result = await db.GameResult.create({
                    gameId: game.id,
                    gamePlayerId: resolvedGamePlayerId,
                    rank: rank++,
                    // Colonne INTEGER : un montant décimal ou négatif ferait échouer l'insert (500)
                    prize: Math.max(0, Math.round(Number(r.prize) || 0)),
                }, { transaction: t });

                createdResults.push(result);
            }

            if (createdResults.length === 0) {
                await t.rollback();
                return res.status(400).json({ error: "No valid players found in results. Make sure players were invited through the game." });
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
                .filter(p => p.userId && p.userId !== game.hostId)
                .map(p => createNotification(p.userId, 'game_result', `Results for "${game.name}" are in`, game.id));
            await Promise.all(notifyPromises);

            // Non-blocking cleanup — remove the result reminder now that the game is finished
            try {
                await db.Notification.destroy({
                    where: { userId: game.hostId, type: "game_result_reminder", referenceId: game.id },
                });
            } catch (err) {
                console.error("Reminder cleanup failed (non-blocking):", err);
            }

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
                attributes: ["id", "name", "status", "dateStart", "dateEnd", "hostId"],
            });
            if (!game) return res.status(404).json({ error: "Game not found" });

            // Réservé à l'hôte et aux joueurs de la partie
            const isPlayer = await db.GamePlayer.count({ where: { gameId, userId: req.user.id } });
            if (game.hostId !== req.user.id && !isPlayer) {
                return res.status(403).json({ error: "You are not part of this game" });
            }

            const results = await db.GameResult.findAll({
                where: { gameId },
                include: [
                    {
                        model: db.GamePlayer,
                        as: "player",
                        attributes: ["id", "guestName", "status"],
                        include: [
                            { model: db.User, as: "user", attributes: ["id", "username"] },
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
