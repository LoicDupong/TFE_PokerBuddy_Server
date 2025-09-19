import { Op } from "sequelize";
import db from "../models/index.js";
import { updateGameStatus } from "../utils/gameStatus.utils.js";


const gameController = {
    createGame: async (req, res) => {
        try {
            const {
                name,
                dateStart,
                buyIn,
                prizePool,
                placesPaid,
                description,
                bigBlind,
                smallBlind,
            } = req.body;
            console.log(req.user.id);

            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const newGame = await db.Game.create({
                name,
                dateStart,
                buyIn,
                prizePool,
                placesPaid,
                description,
                bigBlind,
                smallBlind,
                hostId: req.user.id,
            });

            console.log(newGame);

            res.status(201).json({ game: newGame });
        } catch (error) {
            res.status(500).json({ error: "Error creating game" });
        }
    },

    getAllGames: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const games = await db.Game.findAll({
                include: [
                    {
                        model: db.GameResult,
                        as: "results",
                        required: false,
                        where: { userId: req.user.id }, // filtre sur l’utilisateur connecté
                    },
                    {
                        model: db.User,
                        as: "host",
                        attributes: ["id", "username", "email"],
                        where: { id: req.user.id },
                        required: false,
                    },
                ],
                where: {
                    [Op.or]: [
                        { hostId: req.user.id }, // si user est host
                        { "$results.userId$": req.user.id }, // si user est joueur
                    ],
                },
            });

            res.json({ games });

            const updatedGames = await Promise.all(games.map(game => updateGameStatus(game)));

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
                    {
                        model: db.GameResult,
                        as: "results",
                        include: [
                            {
                                model: db.User,
                                as: "user",
                                attributes: ["id", "username", "email"], // infos du joueur
                            },
                        ],
                    },
                    {
                        model: db.User,
                        as: "host",
                        attributes: ["id", "username", "email"], // infos du host
                    },
                ],
            });
            if (!game) {
                return res.status(404).json({ error: "Game not found" });
            }

            const updatedGame = await updateGameStatus(game);
            res.status(200).json({ game: updatedGame });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Error fetching game" });
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
            if (Number(game.hostId) !== Number(req.user.id)) {
                return res.status(403).json({ error: "Forbidden" });
            }
            if (game.status !== 'pending') {
                return res.status(400).json({ error: "Only pending games can be updated" });
            }

            const { name, buyIn, placesPaid, description, bigBlind, smallBlind } = req.body;

            await game.update({ name, buyIn, placesPaid, description, bigBlind, smallBlind });

            res.status(200).json({ message: "Game updated", game });
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
            if (Number(game.hostId) !== Number(req.user.id)) {
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
