import { Op } from "sequelize";
import { randomUUID } from "crypto";
import db from "../models/index.js";
import { updateGameStatus } from "../utils/gameStatus.utils.js";
import { createNotification } from "../utils/notification.utils.js";

// Les checkboxes arrivent en booléens (validés par zod côté client) ou en "on" (FormData brut)
const toBoolean = (value) => value === true || value === "on" || value === "true";

// realStart arrive en ISO, calculé par le client dans le fuseau de l'utilisateur.
// L'ancien format "HH:mm" (front pas encore mis à jour) est combiné avec dateStart dans le fuseau
// du serveur, comme avant. Vide → null (permet d'effacer l'heure).
const parseRealStart = (realStart, dateStart) => {
    if (!realStart) return null;
    if (/^\d{1,2}:\d{2}$/.test(realStart)) {
        if (!dateStart) return null;
        const combined = new Date(dateStart);
        const [hours, minutes] = realStart.split(":");
        combined.setHours(hours, minutes, 0, 0);
        return combined.toISOString();
    }
    const date = new Date(realStart);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// Bornes du jour de l'utilisateur (minuit local → minuit local du lendemain), envoyées par le client.
// À défaut : minuit dans le fuseau du serveur (UTC sur Render, donc décalé pour la Belgique).
const getDayBounds = ({ dayStart, dayEnd }) => {
    const startOfDay = new Date(dayStart);
    const startOfTomorrow = new Date(dayEnd);
    if (!Number.isNaN(startOfDay.getTime()) && !Number.isNaN(startOfTomorrow.getTime()) && startOfTomorrow > startOfDay) {
        return { startOfDay, startOfTomorrow };
    }
    const fallbackStart = new Date();
    fallbackStart.setHours(0, 0, 0, 0);
    const fallbackTomorrow = new Date(fallbackStart);
    fallbackTomorrow.setDate(fallbackTomorrow.getDate() + 1);
    return { startOfDay: fallbackStart, startOfTomorrow: fallbackTomorrow };
};

const CURRENCIES = ["EUR", "USD", "GBP"];

const isBlank = (value) => value === undefined || value === null || value === "";
// Pourcentage PKO : entier de 0 à 100 (nombre ou chaîne venant d'un formulaire)
const isPercent = (value) => value !== "" && value !== null && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 100;

// Réglages financiers d'une partie envoyés par le formulaire → colonnes (null/défauts si absents)
const readFinanceSettings = (body, { partial = false } = {}) => {
    const fields = {};
    if (!partial || body.rebuyAmountCents !== undefined) {
        fields.rebuyAmountCents = isBlank(body.rebuyAmountCents) ? null : Number(body.rebuyAmountCents);
    }
    if (!partial || body.pkoEnabled !== undefined) fields.pkoEnabled = toBoolean(body.pkoEnabled);
    if (!partial || body.pkoBountyPercent !== undefined) fields.pkoBountyPercent = isBlank(body.pkoBountyPercent) ? 50 : Number(body.pkoBountyPercent);
    if (!partial || body.pkoCashPercent !== undefined) fields.pkoCashPercent = isBlank(body.pkoCashPercent) ? 50 : Number(body.pkoCashPercent);
    return fields;
};

// Une fois de l'argent engagé (Game Manager lancé), ces réglages ne bougent plus :
// les opérations déjà enregistrées seraient rejouées avec d'autres règles
const LOCKED_FINANCE_FIELDS = ["buyIn", "pkoEnabled", "pkoBountyPercent", "pkoCashPercent"];

// Validation serveur des champs d'une partie : le client valide aussi, mais l'API ne doit pas lui faire confiance.
// partial : modification (seuls les champs envoyés sont vérifiés) ; current : valeurs actuelles de la partie.
const validateGameFields = (fields, { partial = false, current = {} } = {}) => {
    const has = (key) => !partial || fields[key] !== undefined;
    const isWholeNumber = (value, min) =>
        value !== "" && value !== null && Number.isInteger(Number(value)) && Number(value) >= min;

    if (has("name") && (typeof fields.name !== "string" || !fields.name.trim())) return "Title is required";
    if (has("location") && (typeof fields.location !== "string" || !fields.location.trim())) return "Location is required";
    if (has("dateStart") && Number.isNaN(new Date(fields.dateStart ?? "").getTime())) return "A valid date is required";
    if (has("buyIn") && !isWholeNumber(fields.buyIn, 0)) return "Buy-in must be a positive whole number";
    if (has("smallBlind") && !isWholeNumber(fields.smallBlind, 1)) return "Small blind must be >= 1";
    if (has("bigBlind") && !isWholeNumber(fields.bigBlind, 1)) return "Big blind must be >= 1";
    if (has("placesPaid") && !isWholeNumber(fields.placesPaid, 1)) return "Places paid must be >= 1";
    if (fields.levelDuration !== undefined && !(isWholeNumber(fields.levelDuration, 1) && Number(fields.levelDuration) <= 120)) {
        return "Level duration must be between 1 and 120 minutes";
    }
    // 0 ou vide = pas de limite de joueurs
    if (fields.maxPlayers && !isWholeNumber(fields.maxPlayers, 2)) return "Max players must be at least 2";
    if (fields.currency && !CURRENCIES.includes(fields.currency)) return "Currency must be EUR, USD or GBP";
    if (fields.description && String(fields.description).length > 500) return "Description too long (500 characters max)";

    // Rebuys / PKO (centimes et pourcentages entiers)
    if (!isBlank(fields.rebuyAmountCents) && !(Number.isSafeInteger(Number(fields.rebuyAmountCents)) && Number(fields.rebuyAmountCents) >= 0)) {
        return "Rebuy price must be a positive amount";
    }
    if (fields.pkoBountyPercent !== undefined && !isPercent(fields.pkoBountyPercent)) {
        return "Bounty share must be a whole percentage between 0 and 100";
    }
    if (fields.pkoCashPercent !== undefined && !isPercent(fields.pkoCashPercent)) {
        return "Knockout cash share must be a whole percentage between 0 and 100";
    }

    const smallBlind = Number(fields.smallBlind ?? current.smallBlind);
    const bigBlind = Number(fields.bigBlind ?? current.bigBlind);
    if (bigBlind <= smallBlind) return "Big blind must be greater than small blind";

    return null;
};

// payoutDistribution : tableau de { place, percent } (ou sa version JSON) dont la somme fait 100 %
const parsePayout = (payoutDistribution) => {
    let parsed;
    try {
        parsed = typeof payoutDistribution === "string" ? JSON.parse(payoutDistribution) : payoutDistribution;
    } catch {
        return { error: "Invalid payout distribution" };
    }
    if (!Array.isArray(parsed) || parsed.some((p) => !(Number(p?.percent) >= 0))) {
        return { error: "Invalid payout distribution" };
    }
    const total = parsed.reduce((sum, p) => sum + Number(p.percent), 0);
    if (Math.abs(total - 100) > 0.01) {
        return { error: "Payout distribution must sum to 100%" };
    }
    return { value: parsed };
};

// Données publiques d'un utilisateur dans les réponses "partie" : jamais l'email
const PUBLIC_USER_ATTRIBUTES = ["id", "username"];

const gameController = {
    createGame: async (req, res) => {
        if (!req.user) return res.status(401).json({ error: "Unauthorized" });

        // Ouverte seulement après les validations : un return anticipé ne doit jamais laisser
        // une transaction (et sa connexion du pool) ouverte
        let t;
        try {
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

            const validationError = validateGameFields(req.body);
            if (validationError) {
                return res.status(400).json({ error: validationError });
            }

            // ✅ PayoutDistribution
            let parsedPayout = null;
            if (payoutDistribution) {
                const payout = parsePayout(payoutDistribution);
                if (payout.error) {
                    return res.status(400).json({ error: payout.error });
                }
                parsedPayout = payout.value;
            }

            const payload = {
                name,
                dateStart,
                realStart: parseRealStart(realStart, dateStart),
                location,
                buyIn: Number(buyIn),
                prizePool: Number(prizePool),
                placesPaid: Number(placesPaid),
                description,
                bigBlind: Number(bigBlind),
                smallBlind: Number(smallBlind),
                levelDuration: Number(levelDuration) || 15,
                enableBlindTimer: toBoolean(enableBlindTimer),
                allowRebuys: toBoolean(allowRebuys),
                maxPlayers: Number(maxPlayers) || null,
                currency: currency || "EUR",
                payoutDistribution: parsedPayout,
                hostId: req.user.id,
                // Prix du rebuy et PKO (désactivé par défaut : partie classique)
                ...readFinanceSettings(req.body),
            };

            const parsedInvites = invites
                ? (typeof invites === "string" ? JSON.parse(invites) : invites)
                : {};
            // L'hôte a déjà sa ligne de joueur, on ne l'invite pas une 2e fois
            const invitedFriends = (parsedInvites.friends ?? []).filter((f) => f.id !== req.user.id);

            t = await db.sequelize.transaction();

            // ✅ Création du Game
            const newGame = await db.Game.create(payload, { transaction: t });

            // ✅ Gestion des joueurs
            // L'hôte joue aussi : sa ligne GamePlayer fait compter ses résultats dans ses stats
            const gamePlayers = [{
                gameId: newGame.id,
                userId: req.user.id,
                userName: req.user.username,
                status: "accepted",
            }];

            for (const f of invitedFriends) {
                gamePlayers.push({
                    gameId: newGame.id,
                    userId: f.id,
                    userName: f.name,
                    status: "pending",
                });
            }

            for (const g of parsedInvites.guests ?? []) {
                gamePlayers.push({
                    gameId: newGame.id,
                    guestName: g,
                    status: "pending",
                });
            }

            for (const e of parsedInvites.emails ?? []) {
                gamePlayers.push({
                    gameId: newGame.id,
                    guestName: e,
                    status: "pending",
                });
            }

            await db.GamePlayer.bulkCreate(gamePlayers, { transaction: t });

            await t.commit();

            // Non-blocking notifications — after commit, like invitePlayer does
            await Promise.all(invitedFriends.map((f) =>
                createNotification(f.id, 'game_invite', `You were invited to "${newGame.name}"`, newGame.id)
            ));

            res.status(201).json({ game: newGame });
        } catch (error) {
            if (t && !t.finished) await t.rollback();
            console.error("❌ CreateGame error");
            console.error("Message:", error.message);
            console.error("Stack:", error.stack);
            if (error.errors) {
                console.error("Sequelize Errors:", error.errors.map(e => e.message));
            }
            res.status(500).json({ error: "Error creating game" });
        }

    },



    getAllGames: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            // Parties de l'utilisateur : hôte, ou joueur via une sous-requête. Filtrer sur
            // "$playerLinks.userId$" tronquait la liste des joueurs renvoyée à sa seule ligne.
            const myGames = (playerStatusCondition) => ({
                [Op.or]: [
                    { hostId: req.user.id },
                    {
                        id: {
                            [Op.in]: db.sequelize.literal(
                                `(SELECT "gameId" FROM game_players WHERE "userId" = ${db.sequelize.escape(req.user.id)} AND ${playerStatusCondition})`
                            ),
                        },
                    },
                ],
            });

            let order = [["dateStart", "DESC"]];
            // Une partie dont on a refusé l'invitation n'apparaît pas dans ses listes
            let where = myGames(`status <> 'refused'`);

            const now = new Date();
            const { startOfDay, startOfTomorrow } = getDayBounds(req.query);

            if (req.query.filter === "upcoming") {
                // Overwrite base where: host always sees their game; players only if they accepted
                where = {
                    ...myGames(`status = 'accepted'`),
                    dateStart: { [Op.gte]: startOfTomorrow },
                    status: "pending",
                };
                order = [["dateStart", "ASC"]];
            } else if (req.query.filter === "today") {
                where.dateStart = { [Op.gte]: startOfDay, [Op.lt]: startOfTomorrow };
                where.status = { [Op.ne]: "finished" };
                order = [["dateStart", "ASC"]];
            } else if (req.query.filter === "finished") {
                where[Op.and] = [
                    {
                        [Op.or]: [
                            { dateStart: { [Op.lt]: startOfDay } },
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
                        attributes: PUBLIC_USER_ATTRIBUTES,
                    },
                    {
                        model: db.GamePlayer,
                        as: "playerLinks",
                        include: [
                            {
                                model: db.User,
                                as: "user",
                                attributes: PUBLIC_USER_ATTRIBUTES,
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
                                        attributes: PUBLIC_USER_ATTRIBUTES,
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
                        attributes: PUBLIC_USER_ATTRIBUTES,
                    },
                    // 🎮 Joueurs (GamePlayers + User/Guest)
                    {
                        model: db.GamePlayer,
                        as: "playerLinks",
                        include: [
                            {
                                model: db.User,
                                as: "user",
                                attributes: PUBLIC_USER_ATTRIBUTES,
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
                                        attributes: PUBLIC_USER_ATTRIBUTES,
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

            // Réservé à l'hôte et aux joueurs invités (même s'ils n'ont pas encore répondu)
            const isParticipant = game.hostId === req.user.id || game.playerLinks.some((p) => p.userId === req.user.id);
            if (!isParticipant) {
                return res.status(403).json({ error: "You are not part of this game" });
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
                maxPlayers,
                currency,
                payoutDistribution
            } = req.body;

            const validationError = validateGameFields(req.body, { partial: true, current: game });
            if (validationError) {
                return res.status(400).json({ error: validationError });
            }

            const fieldsToUpdate = {};

            if (name !== undefined) fieldsToUpdate.name = name;
            if (dateStart !== undefined) fieldsToUpdate.dateStart = dateStart;
            if (location !== undefined) fieldsToUpdate.location = location;
            if (prizePool !== undefined) fieldsToUpdate.prizePool = Number(prizePool) || 0;
            if (buyIn !== undefined) fieldsToUpdate.buyIn = Number(buyIn);
            if (placesPaid !== undefined) fieldsToUpdate.placesPaid = Number(placesPaid);
            if (description !== undefined) fieldsToUpdate.description = description;
            if (bigBlind !== undefined) fieldsToUpdate.bigBlind = Number(bigBlind);
            if (smallBlind !== undefined) fieldsToUpdate.smallBlind = Number(smallBlind);
            if (levelDuration !== undefined) fieldsToUpdate.levelDuration = Number(levelDuration);
            // 0 ou vide = pas de limite de joueurs
            if (maxPlayers !== undefined) fieldsToUpdate.maxPlayers = Number(maxPlayers) || null;
            if (currency !== undefined) fieldsToUpdate.currency = currency;
            if (enableBlindTimer !== undefined) fieldsToUpdate.enableBlindTimer = toBoolean(enableBlindTimer);
            if (allowRebuys !== undefined) fieldsToUpdate.allowRebuys = toBoolean(allowRebuys);

            // 🔹 Handle realStart (ISO, ancien "HH:mm", ou null pour l'effacer)
            if (realStart !== undefined) {
                fieldsToUpdate.realStart = parseRealStart(realStart, dateStart ?? game.dateStart);
            }

            // 🔹 Handle payoutDistribution
            if (payoutDistribution) {
                const payout = parsePayout(payoutDistribution);
                if (payout.error) {
                    return res.status(400).json({ error: payout.error });
                }
                fieldsToUpdate.payoutDistribution = payout.value;
            }

            // 🔹 Prix du rebuy et PKO
            Object.assign(fieldsToUpdate, readFinanceSettings(req.body, { partial: true }));

            // Argent déjà engagé : buy-in et règles PKO verrouillés (seuls les changements réels sont refusés,
            // le formulaire d'édition renvoie tous les champs)
            const changesLockedField = LOCKED_FINANCE_FIELDS.some((field) =>
                fieldsToUpdate[field] !== undefined && fieldsToUpdate[field] !== game[field]);
            if (changesLockedField) {
                const activeOps = await db.GameFinanceOp.count({ where: { gameId: game.id, voidedAt: null } });
                if (activeOps > 0) {
                    return res.status(409).json({ error: "Players have already paid in: the buy-in and bounty settings can't change anymore" });
                }
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

            const game = await db.Game.findByPk(req.params.id, {
                attributes: ["id", "name", "dateStart", "location", "description"],
            });
            if (!game) return res.status(404).json({ error: "Game not found" });

            const start = new Date(game.dateStart);
            const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

            // Le "Z" final marque l'heure comme UTC ; sans lui les agendas la lisent en heure locale
            const fmt = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
            const escape = (str) => (str || "").replace(/[,;\\]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

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

    generateInviteCode: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });
            const { id } = req.params;
            const game = await db.Game.findByPk(id);
            if (!game) return res.status(404).json({ error: "Game not found" });
            if (game.hostId !== req.user.id) return res.status(403).json({ error: "Forbidden" });
            if (game.status === "finished") return res.status(400).json({ error: "Cannot create invite link for a finished game" });

            const inviteCode = randomUUID();
            await game.update({ inviteCode });
            return res.status(200).json({ inviteCode });
        } catch (error) {
            console.error("generateInviteCode error:", error);
            return res.status(500).json({ error: "Error generating invite link" });
        }
    },

    disableInviteCode: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });
            const { id } = req.params;
            const game = await db.Game.findByPk(id);
            if (!game) return res.status(404).json({ error: "Game not found" });
            if (game.hostId !== req.user.id) return res.status(403).json({ error: "Forbidden" });

            await game.update({ inviteCode: null });
            return res.status(200).json({ message: "Invite link disabled" });
        } catch (error) {
            console.error("disableInviteCode error:", error);
            return res.status(500).json({ error: "Error disabling invite link" });
        }
    },

};

export default gameController;
