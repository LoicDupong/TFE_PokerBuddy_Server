import { Op } from "sequelize";
import db from "../models/index.js";
import { updateGameStatus } from "../utils/gameStatus.utils.js";


const gameController = {
    createGame: async (req, res) => {
        const t = await db.sequelize.transaction();
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            let {
                name,
                dateStart,
                realStart,
                location,
                buyIn,
                prizePool,
                placesPaid,
                description,
                bigBlind,
                smallBlind,
                levelDuration,
                enableBlindTimer,
                allowRebuys,
                maxPlayers,
                currency,
                payoutDistribution,
                invites,
            } = req.body;

            // Debug brut de ce que ton front envoie
            console.log("📥 Raw req.body:", req.body);

            // ✅ PayoutDistribution
            let parsedPayout = null;
            if (payoutDistribution) {
                parsedPayout =
                    typeof payoutDistribution === "string"
                        ? JSON.parse(payoutDistribution)
                        : payoutDistribution;

                const total = parsedPayout.reduce(
                    (sum, p) => sum + Number(p.percent),
                    0
                );
                if (total !== 100) {
                    return res
                        .status(400)
                        .json({ error: "Payout distribution must sum to 100%" });
                }
            }

            // ✅ Combine dateStart + realStart
            let realStartDate = null;
            if (realStart && dateStart) {
                const combinedDate = new Date(dateStart);
                const [hours, minutes] = realStart.split(":");
                combinedDate.setHours(hours, minutes, 0, 0);
                realStartDate = combinedDate.toISOString();
            }

            const payload = {
                name,
                dateStart,
                realStart: realStartDate,
                location,
                buyIn: Number(buyIn),
                prizePool: Number(prizePool),
                placesPaid: Number(placesPaid),
                description,
                bigBlind: Number(bigBlind),
                smallBlind: Number(smallBlind),
                levelDuration: Number(levelDuration) || 15,
                enableBlindTimer: enableBlindTimer === "on",
                allowRebuys: allowRebuys === "on",
                maxPlayers: maxPlayers ? Number(maxPlayers) : null,
                currency: currency || "EUR",
                payoutDistribution: parsedPayout,
                hostId: req.user.id,
            };

            // Log clair de ce que tu vas insérer
            console.log("📦 Payload envoyé à Sequelize:", payload);

            // ✅ Création du Game
            const newGame = await db.Game.create(payload, { transaction: t });

            // ✅ Gestion des invites
            if (invites) {
                const parsedInvites =
                    typeof invites === "string" ? JSON.parse(invites) : invites;

                const gamePlayers = [];

                if (parsedInvites.friends?.length) {
                    for (const f of parsedInvites.friends) {
                        gamePlayers.push({
                            gameId: newGame.id,
                            userId: f.id,
                            userName: f.name,
                            isConfirmed: false,
                        });
                    }
                }

                if (parsedInvites.guests?.length) {
                    for (const g of parsedInvites.guests) {
                        gamePlayers.push({
                            gameId: newGame.id,
                            guestName: g,
                            isConfirmed: false,
                        });
                    }
                }

                if (parsedInvites.emails?.length) {
                    for (const e of parsedInvites.emails) {
                        gamePlayers.push({
                            gameId: newGame.id,
                            guestName: e,
                            isConfirmed: false,
                        });
                    }
                }

                if (gamePlayers.length) {
                    console.log("👥 Insertion GamePlayers:", gamePlayers);
                    await db.GamePlayer.bulkCreate(gamePlayers, { transaction: t });
                }
            }

            await t.commit();
            console.log("✅ Game created with invites");

            res.status(201).json({ game: newGame });
        } catch (error) {
            await t.rollback();
            console.error("❌ CreateGame error");
            console.error("Message:", error.message);
            console.error("Stack:", error.stack);
            if (error.errors) {
                console.error("Sequelize Errors:", error.errors.map(e => e.message));
            }
            res.status(500).json({ error: error.message || "Error creating game" });
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

            if (!game) return res.status(404).json({ error: "Game not found" });
            if (game.status === "finished") return res.status(400).json({ error: "Cannot update a finished game" });
            if (game.hostId !== req.user.id) return res.status(403).json({ error: "Forbidden" });

            const {
                name,
                dateStart,
                realStart,
                location,
                buyIn,
                prizePool,
                placesPaid,
                description,
                bigBlind,
                smallBlind,
                levelDuration,
                enableBlindTimer,
                allowRebuys,
                payoutDistribution
            } = req.body;

            const fieldsToUpdate = {};

            if (name !== undefined) fieldsToUpdate.name = name;
            if (dateStart !== undefined) fieldsToUpdate.dateStart = dateStart;
            if (location !== undefined) fieldsToUpdate.location = location;
            if (prizePool !== undefined) fieldsToUpdate.prizePool = prizePool;
            if (buyIn !== undefined) fieldsToUpdate.buyIn = buyIn;
            if (placesPaid !== undefined) fieldsToUpdate.placesPaid = placesPaid;
            if (description !== undefined) fieldsToUpdate.description = description;
            if (bigBlind !== undefined) fieldsToUpdate.bigBlind = bigBlind;
            if (smallBlind !== undefined) fieldsToUpdate.smallBlind = smallBlind;
            if (levelDuration !== undefined) fieldsToUpdate.levelDuration = levelDuration;
            if (enableBlindTimer !== undefined) fieldsToUpdate.enableBlindTimer = enableBlindTimer;
            if (allowRebuys !== undefined) fieldsToUpdate.allowRebuys = allowRebuys;

            // 🔹 Handle realStart (HH:mm → full datetime)
            if (realStart && dateStart) {
                const combinedDate = new Date(dateStart);
                const [hours, minutes] = realStart.split(":");
                combinedDate.setHours(hours, minutes, 0, 0);
                fieldsToUpdate.realStart = combinedDate.toISOString();
            }

            // 🔹 Handle payoutDistribution
            if (payoutDistribution) {
                const parsedPayout = typeof payoutDistribution === "string"
                    ? JSON.parse(payoutDistribution)
                    : payoutDistribution;

                const total = parsedPayout.reduce((sum, p) => sum + Number(p.percent), 0);
                if (total !== 100) {
                    return res.status(400).json({ error: "Payout distribution must sum to 100%" });
                }
                fieldsToUpdate.payoutDistribution = parsedPayout;
            }

            await game.update(fieldsToUpdate);

            res.status(200).json({ message: "Game updated", fieldsToUpdate });

        } catch (error) {
            console.error("Update game error:", error);
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
