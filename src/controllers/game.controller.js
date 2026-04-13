import { Op, or } from "sequelize";
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
                if (Math.abs(total - 100) > 0.01) {
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
                            status: "pending",
                        });
                    }
                }

                if (parsedInvites.guests?.length) {
                    for (const g of parsedInvites.guests) {
                        gamePlayers.push({
                            gameId: newGame.id,
                            guestName: g,
                            status: "pending",
                        });
                    }
                }

                if (parsedInvites.emails?.length) {
                    for (const e of parsedInvites.emails) {
                        gamePlayers.push({
                            gameId: newGame.id,
                            guestName: e,
                            status: "pending",
                        });
                    }
                }

                if (gamePlayers.length) {
                    await db.GamePlayer.bulkCreate(gamePlayers, { transaction: t });
                }
            }

            await t.commit();
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

            let order = [["dateStart", "DESC"]];
            let where = {
                [Op.or]: [
                    { hostId: req.user.id },                // si user est host
                    { "$playerLinks.userId$": req.user.id } // si user est joueur
                ]
            };

            const now = new Date();

            if (req.query.filter === "upcoming") {
                const startOfTomorrow = new Date(now);
                startOfTomorrow.setHours(0, 0, 0, 0);
                startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
                // Overwrite base where: host always sees their game; players only if they accepted
                where = {
                    [Op.or]: [
                        { hostId: req.user.id },
                        {
                            "$playerLinks.userId$": req.user.id,
                            "$playerLinks.status$": "accepted",
                        },
                    ],
                    dateStart: { [Op.gte]: startOfTomorrow },
                    status: "pending",
                };
                order = [["dateStart", "ASC"]];
            } else if (req.query.filter === "today") {
                const startOfDay = new Date(now);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(now);
                endOfDay.setHours(23, 59, 59, 999);
                where.dateStart = { [Op.between]: [startOfDay, endOfDay] };
                where.status = { [Op.ne]: "finished" };
                order = [["dateStart", "ASC"]];
            } else if (req.query.filter === "finished") {
                const startOfToday = new Date(now);
                startOfToday.setHours(0, 0, 0, 0);
                where[Op.and] = [
                    {
                        [Op.or]: [
                            { dateStart: { [Op.lt]: startOfToday } },
                            { status: "finished" }
                        ]
                    }
                ];
                order = [["dateStart", "DESC"]];
            } else if (req.query.filter === "active") {
                where.dateStart = { [Op.lte]: now };
                order = [["dateStart", "DESC"]];
            }

            const games = await db.Game.findAll({
                include: [
                    {
                        model: db.User,
                        as: "host",
                        attributes: ["id", "username", "email"],
                    },
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
                where,
                order,
            });

            const updatedGames = await Promise.all(
                games.map((g) => updateGameStatus(g))
            );

            const result = req.query.filter === "active"
                ? updatedGames.filter((g) => g.status === "active")
                : req.query.filter === "today"
                    ? updatedGames.filter((g) => g.status !== "finished")
                    : updatedGames;

            res.status(200).json({ games: result });
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
                if (Math.abs(total - 100) > 0.01) {
                    return res.status(400).json({ error: "Payout distribution must sum to 100%" });
                }
                fieldsToUpdate.payoutDistribution = parsedPayout;
            }

            await game.update(fieldsToUpdate);
            await updateGameStatus(game);

            res.status(200).json({ message: "Game updated", game });

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

    getGameIcs: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const game = await db.Game.findByPk(req.params.id, {
                attributes: ["id", "name", "dateStart", "location", "description"],
            });
            if (!game) return res.status(404).json({ error: "Game not found" });

            const start = new Date(game.dateStart);
            const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

            const fmt = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0];
            const escape = (str) => (str || "").replace(/[,;\\]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

            const lines = [
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//PokerBuddy//EN",
                "BEGIN:VEVENT",
                `UID:${game.id}@pokerbuddy`,
                `DTSTAMP:${fmt(new Date())}`,
                `DTSTART:${fmt(start)}`,
                `DTEND:${fmt(end)}`,
                `SUMMARY:${escape(game.name)}`,
                game.location ? `LOCATION:${escape(game.location)}` : null,
                game.description ? `DESCRIPTION:${escape(game.description)}` : null,
                "END:VEVENT",
                "END:VCALENDAR",
            ].filter(Boolean).join("\r\n");

            res.setHeader("Content-Type", "text/calendar; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="game-${game.id}.ics"`);
            return res.send(lines);
        } catch (error) {
            console.error("getGameIcs error:", error);
            return res.status(500).json({ error: "Error generating calendar file" });
        }
    },

};

export default gameController;
