import { Op } from "sequelize";
import db from "../models/index.js";
import { updateGameStatus } from "../utils/gameStatus.utils.js";


const gameController = {
    createGame: async (req, res) => {
        try {
            const {
                name,
                dateStart,
                location,
                buyIn,
                prizePool,
                placesPaid,
                description,
                bigBlind,
                smallBlind,
                payoutDistribution,
            } = req.body;

            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            // 🔹 Validation distribution
            if (payoutDistribution) {
                const total = payoutDistribution.reduce((sum, p) => sum + p.percent, 0);
                if (total !== 100) {
                    return res
                        .status(400)
                        .json({ error: "Payout distribution must sum to 100%" });
                }
            }

            const newGame = await db.Game.create({
                name,
                dateStart,
                location,
                buyIn,
                prizePool,
                placesPaid,
                description,
                bigBlind,
                smallBlind,
                payoutDistribution: payoutDistribution || null,
                hostId: req.user.id,
            });

            res.status(201).json({ game: newGame });
        } catch (error) {
            console.error("CreateGame error:", error);
            res.status(500).json({ error: "Error creating game" });
        }
    },


    getAllGames: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const games = await db.Game.findAll({
                include: [
                    // 👑 Host
                    {
                        model: db.User,
                        as: "host",
                        attributes: ["id", "username", "email"],
                    },
                    // 🎮 Joueurs
                    {
                        model: db.GamePlayer,
                        as: "playerLinks",
                        include: [
                            {
                                model: db.User,
                                as: "user",
                                attributes: ["id", "username", "email"],
                            },
                        ],
                    },
                    // 🏆 Résultats
                    {
                        model: db.GameResult,
                        as: "results",
                        include: [
                            {
                                model: db.GamePlayer,
                                as: "player",
                                include: [
                                    {
                                        model: db.User,
                                        as: "user",
                                        attributes: ["id", "username", "email"],
                                    },
                                ],
                            },
                        ],
                    },
                ],
                where: {
                    [Op.or]: [
                        { hostId: req.user.id },                // si user est host
                        { "$playerLinks.userId$": req.user.id } // si user est joueur
                    ],
                },
                order: [["dateStart", "DESC"]],
            });

            const updatedGames = await Promise.all(
                games.map((g) => updateGameStatus(g))
            );

            res.status(200).json({ games: updatedGames });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Error fetching games" });
        }
    },

    getGameById: async (req, res) => {
        try {
            const { id } = req.params;
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const game = await db.Game.findByPk(id, {
                include: [
                    // 👑 Host
                    {
                        model: db.User,
                        as: "host",
                        attributes: ["id", "username", "email"],
                    },
                    // 🎮 Joueurs (GamePlayers + User/Guest)
                    {
                        model: db.GamePlayer,
                        as: "playerLinks",
                        include: [
                            {
                                model: db.User,
                                as: "user",
                                attributes: ["id", "username", "email"],
                            },
                        ],
                    },
                    // 🏆 Résultats (GameResult -> GamePlayer -> User)
                    {
                        model: db.GameResult,
                        as: "results",
                        include: [
                            {
                                model: db.GamePlayer,
                                as: "player",
                                include: [
                                    {
                                        model: db.User,
                                        as: "user",
                                        attributes: ["id", "username", "email"],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });

            if (!game) {
                return res.status(404).json({ error: "Game not found" });
            }

            const updatedGame = await updateGameStatus(game);

            res.status(200).json({
                game: updatedGame,
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Error fetching game details" });
        }
    },


    updateGame: async (req, res) => {
        try {
            const { id } = req.params;
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const game = await db.Game.findByPk(id);

            if (!game) {
                return res.status(404).json({ error: "Game not found" });
            }
            if (game.status === "finished") {
                return res.status(400).json({ error: "Cannot update a finished game" });
            }
            if (game.hostId !== req.user.id) {
                return res.status(403).json({ error: "Forbidden" });
            }

            if (game.status !== 'finished' && game.hostId === req.user.id) {
                const { name, dateStart, location, buyIn, prizePool, placesPaid, description, bigBlind, smallBlind, payoutDistribution } = req.body;

                const fieldsToUpdate = {};
                if (name) fieldsToUpdate.name = name;
                if (dateStart) fieldsToUpdate.dateStart = dateStart;
                if (location) fieldsToUpdate.location = location;
                if (prizePool) fieldsToUpdate.prizePool = prizePool;
                if (buyIn) fieldsToUpdate.buyIn = buyIn;
                if (placesPaid) fieldsToUpdate.placesPaid = placesPaid;
                if (description) fieldsToUpdate.description = description;
                if (bigBlind) fieldsToUpdate.bigBlind = bigBlind;
                if (smallBlind) fieldsToUpdate.smallBlind = smallBlind;

                // 🔹 Validation + update de la distribution
                if (payoutDistribution) {
                    const total = payoutDistribution.reduce((sum, p) => sum + p.percent, 0);
                    if (total !== 100) {
                        return res
                            .status(400)
                            .json({ error: "Payout distribution must sum to 100%" });
                    }
                    fieldsToUpdate.payoutDistribution = payoutDistribution;
                }

                await game.update(fieldsToUpdate);
                res.status(200).json({ message: "Game updated", fieldsToUpdate });
            }


        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Error updating game" });
        }
    },
    deleteGame: async (req, res) => {
        try {
            const { id } = req.params;

            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const game = await db.Game.findByPk(id);

            if (!game) {
                return res.status(404).json({ error: "Game not found" });
            }
            if (game.hostId !== req.user.id) {
                return res.status(403).json({ error: "Forbidden" });
            }

            await game.destroy();

            res.status(200).json({ message: "Game deleted" });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Error deleting game" });
        }
    },


};

export default gameController;
