import db from "../models/index.js";
import { createNotification } from "../utils/notification.utils.js";
import { generateGuestToken, verifyGuestToken } from "../utils/jwt.utils.js";

const ANSWERS = ["accepted", "refused"];

// Contrôles communs aux réponses d'invité (création et changement)
async function checkGuestAnswer(game, status, selfId = null) {
    if (!ANSWERS.includes(status)) return { code: 400, error: "Invalid status" };
    if (game.status === "finished") return { code: 400, error: "This game is already finished" };
    if (status === "accepted" && game.maxPlayers) {
        const accepted = await db.GamePlayer.findAll({ where: { gameId: game.id, status: "accepted" } });
        // Un invité déjà confirmé qui répète "accepted" ne prend pas une place de plus
        if (accepted.filter(p => p.id !== selfId).length >= game.maxPlayers) {
            return { code: 400, error: "This game is full" };
        }
    }
    return null;
}

async function notifyHost(game, guestName, status) {
    const text = status === "accepted" ? "accepted" : "declined";
    await createNotification(game.hostId, "game_invite_responded", `${guestName} (guest) ${text} your invitation to "${game.name}"`, game.id);
}

const joinController = {
    // Résumé public pour la page d'arrivée (aucune donnée sensible)
    getJoinInfo: async (req, res) => {
        try {
            const game = await db.Game.findOne({
                where: { inviteCode: req.params.token },
                include: [
                    { model: db.User, as: "host", attributes: ["username"] },
                    { model: db.GamePlayer, as: "playerLinks", attributes: ["status"] },
                ],
            });
            if (!game) return res.status(404).json({ error: "Invalid or disabled invite link" });

            return res.status(200).json({
                gameId: game.id,
                name: game.name,
                host: game.host?.username ?? null,
                dateStart: game.dateStart,
                location: game.location,
                buyIn: game.buyIn,
                currency: game.currency,
                maxPlayers: game.maxPlayers,
                confirmedCount: game.playerLinks.filter(p => p.status === "accepted").length,
                status: game.status,
            });
        } catch (error) {
            console.error("getJoinInfo error:", error);
            return res.status(500).json({ error: "Error fetching game" });
        }
    },

    // Réponse sans compte : crée un GamePlayer invité
    answerAsGuest: async (req, res) => {
        try {
            const { token } = req.params;
            const { status } = req.body ?? {};
            const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";

            if (name.length < 1 || name.length > 30) {
                return res.status(400).json({ error: "Name must be between 1 and 30 characters" });
            }

            const game = await db.Game.findOne({ where: { inviteCode: token } });
            if (!game) return res.status(404).json({ error: "Invalid or disabled invite link" });

            const problem = await checkGuestAnswer(game, status);
            if (problem) return res.status(problem.code).json({ error: problem.error });

            // Comparaison insensible à la casse pour éviter deux "Marc"/"marc"
            const players = await db.GamePlayer.findAll({ where: { gameId: game.id } });
            const lower = name.toLowerCase();
            const taken = players.some(p => (p.guestName ?? p.userName ?? "").toLowerCase() === lower);
            if (taken) return res.status(409).json({ error: "This name is already taken in this game" });

            const player = await db.GamePlayer.create({ gameId: game.id, guestName: name, userId: null, status });
            await notifyHost(game, name, status);

            const guestToken = generateGuestToken({ gamePlayerId: player.id, gameId: game.id });
            return res.status(201).json({ gamePlayerId: player.id, guestToken });
        } catch (error) {
            console.error("answerAsGuest error:", error);
            return res.status(500).json({ error: "Error saving your answer" });
        }
    },

    // Un invité change sa réponse avec son jeton
    updateGuestAnswer: async (req, res) => {
        try {
            const { guestToken, status } = req.body ?? {};
            const data = verifyGuestToken(guestToken);
            if (!data) return res.status(401).json({ error: "Invalid or expired guest token" });

            const player = await db.GamePlayer.findByPk(data.gamePlayerId, { include: [{ model: db.Game, as: "game" }] });
            if (!player || player.gameId !== data.gameId) return res.status(404).json({ error: "Answer not found" });

            const problem = await checkGuestAnswer(player.game, status, player.id);
            if (problem) return res.status(problem.code).json({ error: problem.error });

            if (player.status !== status) {
                await player.update({ status });
                await notifyHost(player.game, player.userName || player.guestName, status);
            }
            return res.status(200).json({ gamePlayerId: player.id, status: player.status });
        } catch (error) {
            console.error("updateGuestAnswer error:", error);
            return res.status(500).json({ error: "Error saving your answer" });
        }
    },

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
