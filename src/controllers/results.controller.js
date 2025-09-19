import db from "../models/index.js";
import { updateGameStatus } from "../utils/gameStatus.utils.js";

const resultsController = {
    getResultsbyId: async (req, res) => {
        try {
            const { id } = req.params;
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });
            
            
            const result = await db.GameResult.findByPk(id, {
                include: [
                    {
                        model: db.User,
                        as: "user",
                        attributes: ["id", "username", "email"], // infos du joueur
                    },
                    {
                        model: db.Game,
                        as: "game",
                        attributes: ["id", "name", "status"], // infos du jeu
                    },
                ],
            });
            if (!result) {
                return res.status(404).json({ error: "Game Results not found" });
            }
            
            const updatedGame = await updateGameStatus(result.game);

            // Vérification que la game soit terminée
            if (updatedGame.status !== 'finished') {
                return res.status(403).json({ error: "Forbidden: Game not finished yet" });
            }

            
            res.status(200).json({ result: updatedGame });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Error fetching game results" });
        }
    },
};


