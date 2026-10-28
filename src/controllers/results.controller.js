import db from "../models/index.js";
import { createNotification } from "../utils/notification.utils.js";
import { getFinanceAccess } from "../utils/financeAccess.utils.js";
import { centsToUnits, computeRecap, formatCents, isCents, unitsToCents } from "../utils/finance.utils.js";
import {
    FinanceError,
    buildFinanceView,
    hasActiveOps,
    loadFinanceContext,
    replay,
} from "../utils/financeData.utils.js";

// Ligne de résultat envoyée par le client : prizeCents (nouveau client) ou prize en unités (ancien)
function readResultRow(r) {
    if (!r || typeof r !== "object") return { error: "Invalid result row" };
    if (r.prizeCents !== undefined && r.prizeCents !== null) {
        if (!isCents(r.prizeCents)) return { error: "Prizes must be positive amounts in cents" };
        return { value: { ...r, prizeCents: r.prizeCents } };
    }
    // Ancien format : colonne INTEGER, un montant décimal ou négatif ferait échouer l'insert (500)
    const prize = Math.max(0, Math.round(Number(r.prize) || 0));
    return { value: { ...r, prizeCents: unitsToCents(prize) } };
}

const resultsController = {

    createResults: async (req, res) => {
        if (!req.user) return res.status(401).json({ error: "Unauthorized" });

        const { gameId } = req.params;
        const { results, finishedAt } = req.body ?? {};

        // Vérif données envoyées (avant d'ouvrir la transaction)
        if (!Array.isArray(results) || results.length === 0) {
            return res.status(400).json({ error: "Results must be a non-empty array" });
        }
        if (results.length > 200) return res.status(400).json({ error: "Too many results" });
        const rows = [];
        for (const r of results) {
            const row = readResultRow(r);
            if (row.error) return res.status(400).json({ error: row.error });
            rows.push(row.value);
        }
        const endDate = finishedAt ? new Date(finishedAt) : new Date();
        if (Number.isNaN(endDate.getTime())) return res.status(400).json({ error: "Invalid end time" });

        try {
            const { game, createdResults } = await db.sequelize.transaction(async (t) => {
                // Partie verrouillée : aucune opération financière ne peut s'intercaler pendant la clôture
                const ctx = await loadFinanceContext(gameId, { transaction: t, lock: true });
                if (!ctx) throw new FinanceError(404, "Game not found");
                const { game } = ctx;

                // Vérif host
                if (!getFinanceAccess(req.user, game).canWrite) {
                    throw new FinanceError(403, "Only the host can submit results");
                }

                // Vérif statut : une partie "finished" sans résultats (ancien passage auto après 24 h)
                // peut encore recevoir ses résultats
                if (game.status === "finished" && ctx.results.length > 0) {
                    throw new FinanceError(400, "Results already submitted for this game");
                }

                // 🔹 Supprimer anciens résultats
                await db.GameResult.destroy({ where: { gameId: game.id }, transaction: t });

                // 🔹 Joueurs du classement (l'ordre de la liste = le classement)
                const ranked = [];
                for (const r of rows) {
                    const player = ctx.gamePlayers.find(p => p.id === r.gamePlayerId);

                    let resolvedGamePlayerId;
                    if (player) {
                        resolvedGamePlayerId = player.id;
                    } else {
                        // Unknown ID — walk-in player added in the manager, not in the original invite list
                        // (le Game Manager leur donne désormais un GamePlayer dès le lancement : même ligne retrouvée ici)
                        const name = typeof r.guestName === "string" ? r.guestName.trim().replace(/\s+/g, " ") : "";
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
                    if (ranked.some((x) => x.gamePlayerId === resolvedGamePlayerId)) {
                        throw new FinanceError(400, "A player appears twice in the results");
                    }
                    ranked.push({ gamePlayerId: resolvedGamePlayerId, rank: ranked.length + 1, prizeCents: r.prizeCents });
                }

                if (ranked.length === 0) {
                    throw new FinanceError(400, "No valid players found in results. Make sure players were invited through the game.");
                }

                // 🔹 Partie suivie par le Game Manager (buy-ins, rebuys, KO) : les montants viennent des opérations
                let money = null;
                if (hasActiveOps(ctx.ops)) {
                    const finance = replay(ctx, ctx.ops, { finished: true });
                    if (finance.issues.length) throw new FinanceError(409, finance.issues[0].reason);

                    // Tout joueur qui a payé doit être classé, sinon son investissement disparaîtrait des comptes
                    const missing = finance.players.filter((p) => p.seated && !ranked.some((r) => r.gamePlayerId === p.id));
                    if (missing.length) {
                        throw new FinanceError(400, `Every player who paid in needs a place (missing: ${missing.map((p) => p.name).join(", ")})`);
                    }
                    // Le prize pool est redistribué en entier : ni centime perdu, ni centime créé
                    const distributed = ranked.reduce((s, r) => s + r.prizeCents, 0);
                    if (distributed !== finance.totals.prizePoolCents) {
                        throw new FinanceError(400, `Prizes must add up to the prize pool: ${formatCents(finance.totals.prizePoolCents)} ${game.currency} (currently ${formatCents(distributed)})`);
                    }
                    money = new Map(computeRecap(finance, ranked).rows.map((row) => [row.gamePlayerId, row]));
                }

                // 🔹 Enregistrer les nouveaux résultats
                const createdResults = [];
                for (const r of ranked) {
                    const row = money?.get(r.gamePlayerId);
                    const result = await db.GameResult.create({
                        gameId: game.id,
                        gamePlayerId: r.gamePlayerId,
                        rank: r.rank,
                        // Colonne historique en unités (anciens écrans) ; les centimes font foi quand ils existent
                        prize: centsToUnits(r.prizeCents),
                        ...(row ? {
                            prizeCents: row.prizeCents,
                            bountyCents: row.bountyTotalCents,
                            investedCents: row.investedCents,
                        } : {}),
                    }, { transaction: t });
                    createdResults.push(result);
                }

                // 🔹 Répartition réellement distribuée : le manager a pu changer celle prévue à la création
                // (les stats "places payées" lisent placesPaid)
                const paid = ranked.filter(r => r.prizeCents > 0);
                const totalPaidCents = paid.reduce((sum, r) => sum + r.prizeCents, 0);
                const payoutFields = totalPaidCents > 0 ? {
                    placesPaid: paid.length,
                    prizePool: centsToUnits(totalPaidCents),
                    payoutDistribution: paid.map(r => ({
                        place: r.rank,
                        percent: Math.round((r.prizeCents / totalPaidCents) * 10000) / 100,
                    })),
                } : {};

                // 🔹 Terminer la game
                await game.update({
                    status: "finished",
                    dateEnd: endDate,
                    ...payoutFields,
                }, { transaction: t });

                return { game, createdResults };
            });

            // Non-blocking notifications — must be after commit so game.id is stable
            const players = await db.GamePlayer.findAll({ where: { gameId: game.id }, attributes: ["userId"] });
            const notifyPromises = players
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

            const ctx = await loadFinanceContext(game.id);
            return res.status(201).json({
                message: "Results saved",
                results: createdResults.sort((a, b) => a.rank - b.rank),
                // Récapitulatif financier final (null pour une partie sans opérations)
                finance: buildFinanceView(ctx),
            });

        } catch (error) {
            if (error instanceof FinanceError) return res.status(error.status).json({ error: error.message });
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
