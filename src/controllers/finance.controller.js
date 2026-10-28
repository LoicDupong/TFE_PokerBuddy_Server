import { randomUUID } from "crypto";
import { UniqueConstraintError } from "sequelize";
import db from "../models/index.js";
import { isUuid } from "../utils/validation.utils.js";
import { getFinanceAccess } from "../utils/financeAccess.utils.js";
import { isCents, nextSeq, unitsToCents } from "../utils/finance.utils.js";
import {
    FinanceError,
    buildFinanceView,
    loadFinanceContext,
    playerName,
    replay,
    toPlainOp,
} from "../utils/financeData.utils.js";

// Finances d'une partie pendant le Game Manager : buy-ins (places), rebuys, add-ons, knockouts PKO.
// Chaque écriture : validation de la requête → transaction (partie verrouillée) → droits → état
// de la partie → rejeu des opérations avec la nouvelle → enregistrement seulement si tout l'historique
// reste cohérent. Les montants sont en centimes entiers.

const MAX_SEATS = 100;
const MAX_ELIMINATORS = 10;

// ─── Validation des requêtes (avant toute transaction) ─────────────────

// Montant envoyé par le client : entier en centimes, jamais négatif
function readCents(value, label = "Amount") {
    if (typeof value !== "number" || !Number.isFinite(value)) return { error: `${label} is required` };
    if (value < 0) return { error: `${label} can't be negative` };
    if (!isCents(value)) return { error: `${label} must be a whole number of cents` };
    return { value };
}

// Jetons : optionnels, entier positif
function readChips(value) {
    if (value === undefined || value === null || value === "") return { value: null };
    if (!isCents(value)) return { error: "Chips must be a positive whole number" };
    return { value };
}

// Éliminateur(s) : "eliminatorIds" (tableau) ou "eliminatorId" (raccourci pour un seul)
function readEliminators(body) {
    const ids = Array.isArray(body.eliminatorIds) ? body.eliminatorIds : body.eliminatorId ? [body.eliminatorId] : [];
    if (ids.length === 0) return { error: "Pick who made the knockout" };
    if (ids.length > MAX_ELIMINATORS) return { error: "Too many players picked" };
    if (!ids.every(isUuid)) return { error: "Invalid player" };
    if (new Set(ids).size !== ids.length) return { error: "The same player was picked twice" };
    return { value: ids };
}

// ─── Exécution commune ─────────────────────────────────────────────────

const sendError = (res, error, fallback) => {
    if (error instanceof FinanceError) return res.status(error.status).json({ error: error.message });
    // Course entre deux requêtes avec le même opId sur des parties différentes : l'index unique tranche
    if (error instanceof UniqueConstraintError) {
        return res.status(409).json({ error: "This operation was already recorded" });
    }
    console.error(fallback, error);
    return res.status(500).json({ error: fallback });
};

// Partie verrouillée + hôte + résultats pas encore saisis
async function openWriteContext(req, t) {
    const ctx = await loadFinanceContext(req.params.gameId, { transaction: t, lock: true });
    if (!ctx) throw new FinanceError(404, "Game not found");
    if (!getFinanceAccess(req.user, ctx.game).canWrite) {
        throw new FinanceError(403, "Only the host can manage the game's money");
    }
    return ctx;
}

function assertOpen(ctx) {
    if (ctx.results.length > 0) {
        throw new FinanceError(409, "Results are already in: the game's money can't change anymore");
    }
}

// Rejoue l'historique candidat : toute opération incohérente annule l'écriture
function assertConsistent(ctx, ops, message = (reason) => reason) {
    const finance = replay(ctx, ops);
    if (finance.issues.length) throw new FinanceError(409, message(finance.issues[0].reason));
    return finance;
}

// Même opId déjà enregistré : renvoi idempotent si c'est la même action, conflit sinon
function findDuplicate(ctx, opId, sameAction) {
    const existing = ctx.ops.find((op) => op.opId === opId);
    if (!existing) return null;
    if (!sameAction(existing)) throw new FinanceError(409, "This operation id was already used for another action");
    return existing;
}

async function respond(res, gameId, status, extra = {}) {
    const ctx = await loadFinanceContext(gameId);
    return res.status(status).json({ ...extra, finance: buildFinanceView(ctx) });
}

const historyItem = (ctx, id) => replay(ctx).history.find((h) => h.id === id) ?? null;

async function createOp(ctx, data, req, t) {
    const created = await db.GameFinanceOp.create({
        ...data,
        gameId: ctx.game.id,
        createdById: req.user.id,
    }, { transaction: t });
    return toPlainOp(created);
}

// ─── Contrôleur ────────────────────────────────────────────────────────

const financeController = {
    // GET /games/:gameId/finance — état courant (et récapitulatif final une fois les résultats saisis)
    getFinance: async (req, res) => {
        try {
            const ctx = await loadFinanceContext(req.params.gameId);
            if (!ctx) return res.status(404).json({ error: "Game not found" });
            const isPlayer = ctx.gamePlayers.some((gp) => gp.userId === req.user.id);
            if (!getFinanceAccess(req.user, ctx.game, { isPlayer }).canRead) {
                return res.status(403).json({ error: "You are not part of this game" });
            }
            return res.status(200).json({ finance: buildFinanceView(ctx) });
        } catch (error) {
            return sendError(res, error, "Error fetching the game's money");
        }
    },

    // POST /games/:gameId/finance/seats — joueurs assis à la table au lancement du Game Manager.
    // Body : { players: [{ key, gamePlayerId?, name }], chips? }
    // Crée le GamePlayer des joueurs ajoutés sur place (walk-ins), enregistre un buy-in pour chaque
    // joueur qui n'en a pas encore, et annule celui des joueurs retirés de la liste (s'ils n'ont rien d'autre).
    // Idempotent : renvoyer la même liste ne change rien.
    syncSeats: async (req, res) => {
        const { players, chips: rawChips } = req.body ?? {};
        if (!Array.isArray(players) || players.length > MAX_SEATS) {
            return res.status(400).json({ error: `Players must be a list of ${MAX_SEATS} players at most` });
        }
        const chips = readChips(rawChips);
        if (chips.error) return res.status(400).json({ error: chips.error });
        const keys = new Set();
        for (const p of players) {
            if (typeof p?.key !== "string" || !p.key || p.key.length > 100 || keys.has(p.key)) {
                return res.status(400).json({ error: "Each player needs a unique key" });
            }
            keys.add(p.key);
            const name = typeof p.name === "string" ? p.name.trim().replace(/\s+/g, " ") : "";
            if (name.length > 60) return res.status(400).json({ error: "Player names are 60 characters max" });
            p.name = name;
        }

        try {
            const seats = await db.sequelize.transaction(async (t) => {
                const ctx = await openWriteContext(req, t);
                assertOpen(ctx);
                const before = assertConsistent(ctx, ctx.ops);
                const byId = new Map(ctx.gamePlayers.map((gp) => [gp.id, gp]));

                // 1. Chaque joueur de la liste → sa ligne game_players (créée pour un walk-in)
                const resolved = [];
                const used = new Map();
                for (const p of players) {
                    let gp = isUuid(p.gamePlayerId) ? byId.get(p.gamePlayerId) : null;
                    if (!gp) {
                        if (!p.name) throw new FinanceError(400, "Every player needs a name");
                        // Même règle que la saisie des résultats : un invité est retrouvé par son nom
                        gp = ctx.gamePlayers.find((row) => !row.userId && row.guestName?.toLowerCase() === p.name.toLowerCase());
                        if (!gp) {
                            gp = await db.GamePlayer.create(
                                { gameId: ctx.game.id, guestName: p.name, status: "accepted" },
                                { transaction: t }
                            );
                            ctx.gamePlayers.push(gp);
                            byId.set(gp.id, gp);
                        }
                    }
                    if (used.has(gp.id)) throw new FinanceError(400, `${playerName(gp)} is listed twice`);
                    used.set(gp.id, p.key);
                    // Assis à la table = présent : une invitation sans réponse devient acceptée
                    if (gp.status !== "accepted") await gp.update({ status: "accepted" }, { transaction: t });
                    resolved.push({ key: p.key, gamePlayerId: gp.id, name: playerName(gp) });
                }

                // 2. Joueurs retirés de la liste : buy-in annulé, sauf s'ils ont déjà autre chose
                const ops = [...ctx.ops];
                const now = new Date();
                const blocked = [];
                for (const seated of before.players.filter((p) => p.seated && !used.has(p.id))) {
                    const involved = ops.some((op) => !op.voidedAt && (
                        (op.gamePlayerId === seated.id && op.type !== "buyin")
                        || (op.eliminatorIds ?? []).includes(seated.id)
                    ));
                    if (involved) {
                        blocked.push(seated.name);
                        continue;
                    }
                    for (const op of ops.filter((o) => !o.voidedAt && o.type === "buyin" && o.gamePlayerId === seated.id)) {
                        await db.GameFinanceOp.update(
                            { voidedAt: now, voidedById: req.user.id },
                            { where: { id: op.id }, transaction: t }
                        );
                        op.voidedAt = now;
                    }
                }
                if (blocked.length) {
                    throw new FinanceError(409, `${blocked.join(", ")} already ${blocked.length > 1 ? "have" : "has"} rebuys or knockouts and can't be removed`);
                }

                // 3. Buy-in pour chaque joueur pas encore assis
                const buyInCents = unitsToCents(ctx.game.buyIn ?? 0);
                for (const seat of resolved) {
                    if (before.players.find((p) => p.id === seat.gamePlayerId)?.seated) continue;
                    const op = await createOp(ctx, {
                        opId: randomUUID(),
                        seq: nextSeq(ops),
                        type: "buyin",
                        gamePlayerId: seat.gamePlayerId,
                        amountCents: buyInCents,
                        chips: chips.value,
                    }, req, t);
                    ops.push(op);
                }

                assertConsistent(ctx, ops);
                return resolved;
            });
            return await respond(res, req.params.gameId, 200, { seats });
        } catch (error) {
            return sendError(res, error, "Error saving the players");
        }
    },

    // POST /games/:gameId/finance/entries — rebuy ou add-on
    // Body : { opId, type: "rebuy" | "addon", gamePlayerId, amountCents, chips? }
    createEntry: async (req, res) => {
        const { opId, type, gamePlayerId } = req.body ?? {};
        if (!isUuid(opId)) return res.status(400).json({ error: "A valid opId is required" });
        if (!["rebuy", "addon"].includes(type)) return res.status(400).json({ error: "Type must be rebuy or addon" });
        if (!isUuid(gamePlayerId)) return res.status(400).json({ error: "Pick a player" });
        const amount = readCents(req.body.amountCents);
        if (amount.error) return res.status(400).json({ error: amount.error });
        const chips = readChips(req.body.chips);
        if (chips.error) return res.status(400).json({ error: chips.error });

        try {
            const result = await db.sequelize.transaction(async (t) => {
                const ctx = await openWriteContext(req, t);
                const duplicate = findDuplicate(ctx, opId, (op) =>
                    op.type === type && op.gamePlayerId === gamePlayerId && op.amountCents === amount.value
                    && (op.chips ?? null) === chips.value && !op.correctsId);
                if (duplicate) return { id: duplicate.id, duplicate: true };

                assertOpen(ctx);
                if (!ctx.game.allowRebuys) throw new FinanceError(400, "Rebuys and add-ons are off for this game");
                if (!ctx.gamePlayers.some((gp) => gp.id === gamePlayerId)) {
                    throw new FinanceError(400, "This player is not part of the game");
                }
                const op = await createOp(ctx, {
                    opId,
                    seq: nextSeq(ctx.ops),
                    type,
                    gamePlayerId,
                    amountCents: amount.value,
                    chips: chips.value,
                }, req, t);
                assertConsistent(ctx, [...ctx.ops, op]);
                return { id: op.id, duplicate: false };
            });
            const ctx = await loadFinanceContext(req.params.gameId);
            return res.status(result.duplicate ? 200 : 201).json({
                op: historyItem(ctx, result.id),
                duplicate: result.duplicate,
                finance: buildFinanceView(ctx),
            });
        } catch (error) {
            return sendError(res, error, "Error saving the entry");
        }
    },

    // POST /games/:gameId/finance/knockouts — élimination PKO, éliminateur(s) choisi(s) par l'hôte
    // Body : { opId, eliminatedId, eliminatorIds: [id, …] } (ou eliminatorId)
    createKnockout: async (req, res) => {
        const { opId, eliminatedId } = req.body ?? {};
        if (!isUuid(opId)) return res.status(400).json({ error: "A valid opId is required" });
        if (!isUuid(eliminatedId)) return res.status(400).json({ error: "Pick the eliminated player" });
        const eliminators = readEliminators(req.body ?? {});
        if (eliminators.error) return res.status(400).json({ error: eliminators.error });
        if (eliminators.value.includes(eliminatedId)) {
            return res.status(400).json({ error: "A player cannot knock themselves out" });
        }

        try {
            const result = await db.sequelize.transaction(async (t) => {
                const ctx = await openWriteContext(req, t);
                const duplicate = findDuplicate(ctx, opId, (op) =>
                    op.type === "knockout" && op.gamePlayerId === eliminatedId && !op.correctsId
                    && JSON.stringify(op.eliminatorIds) === JSON.stringify(eliminators.value));
                if (duplicate) return { id: duplicate.id, duplicate: true };

                assertOpen(ctx);
                if (!ctx.game.pkoEnabled) throw new FinanceError(400, "Knockouts are only tracked in PKO games");
                const ids = new Set(ctx.gamePlayers.map((gp) => gp.id));
                if (![eliminatedId, ...eliminators.value].every((id) => ids.has(id))) {
                    throw new FinanceError(400, "This player is not part of the game");
                }
                const op = await createOp(ctx, {
                    opId,
                    seq: nextSeq(ctx.ops),
                    type: "knockout",
                    gamePlayerId: eliminatedId,
                    eliminatorIds: eliminators.value,
                }, req, t);
                assertConsistent(ctx, [...ctx.ops, op]);
                return { id: op.id, duplicate: false };
            });
            const ctx = await loadFinanceContext(req.params.gameId);
            return res.status(result.duplicate ? 200 : 201).json({
                op: historyItem(ctx, result.id),
                duplicate: result.duplicate,
                finance: buildFinanceView(ctx),
            });
        } catch (error) {
            return sendError(res, error, "Error saving the knockout");
        }
    },

    // POST /games/:gameId/finance/ops/:financeOpId/void — annulation (l'historique garde l'opération)
    // Idempotent : annuler une opération déjà annulée renvoie 200.
    voidOp: async (req, res) => {
        try {
            const id = await db.sequelize.transaction(async (t) => {
                const ctx = await openWriteContext(req, t);
                const target = ctx.ops.find((op) => op.id === req.params.financeOpId);
                if (!target) throw new FinanceError(404, "Operation not found");
                if (target.voidedAt) return target.id;
                assertOpen(ctx);
                if (target.type === "buyin") {
                    throw new FinanceError(400, "To cancel a buy-in, remove the player from the game setup");
                }
                const now = new Date();
                const ops = ctx.ops.map((op) => (op.id === target.id ? { ...op, voidedAt: now } : op));
                assertConsistent(ctx, ops, (reason) => `Undo the later actions first (${reason})`);
                await db.GameFinanceOp.update(
                    { voidedAt: now, voidedById: req.user.id },
                    { where: { id: target.id }, transaction: t }
                );
                return target.id;
            });
            const ctx = await loadFinanceContext(req.params.gameId);
            return res.status(200).json({ op: historyItem(ctx, id), finance: buildFinanceView(ctx) });
        } catch (error) {
            return sendError(res, error, "Error undoing the operation");
        }
    },

    // POST /games/:gameId/finance/ops/:financeOpId/correct — correction (montant d'une entrée,
    // éliminateur d'un KO) : l'opération est annulée et remplacée au même rang de l'historique.
    // Body : { opId, amountCents?, chips? } (entrée) ou { opId, eliminatorIds } (knockout)
    correctOp: async (req, res) => {
        const { opId } = req.body ?? {};
        if (!isUuid(opId)) return res.status(400).json({ error: "A valid opId is required" });

        try {
            const result = await db.sequelize.transaction(async (t) => {
                const ctx = await openWriteContext(req, t);
                const target = ctx.ops.find((op) => op.id === req.params.financeOpId);
                if (!target) throw new FinanceError(404, "Operation not found");
                const duplicate = findDuplicate(ctx, opId, (op) => op.correctsId === target.id);
                if (duplicate) return { id: duplicate.id, duplicate: true };

                assertOpen(ctx);
                if (target.voidedAt) throw new FinanceError(409, "This action was already changed or undone");

                const replacement = {
                    opId,
                    seq: target.seq,
                    type: target.type,
                    gamePlayerId: target.gamePlayerId,
                    correctsId: target.id,
                };
                if (target.type === "knockout") {
                    const eliminators = readEliminators(req.body);
                    if (eliminators.error) throw new FinanceError(400, eliminators.error);
                    if (eliminators.value.includes(target.gamePlayerId)) {
                        throw new FinanceError(400, "A player cannot knock themselves out");
                    }
                    if (!eliminators.value.every((id) => ctx.gamePlayers.some((gp) => gp.id === id))) {
                        throw new FinanceError(400, "This player is not part of the game");
                    }
                    if (JSON.stringify(eliminators.value) === JSON.stringify(target.eliminatorIds)) {
                        throw new FinanceError(400, "Nothing to change");
                    }
                    replacement.eliminatorIds = eliminators.value;
                } else {
                    const amount = readCents(req.body.amountCents);
                    if (amount.error) throw new FinanceError(400, amount.error);
                    const chips = req.body.chips === undefined ? { value: target.chips ?? null } : readChips(req.body.chips);
                    if (chips.error) throw new FinanceError(400, chips.error);
                    if (amount.value === target.amountCents && chips.value === (target.chips ?? null)) {
                        throw new FinanceError(400, "Nothing to change");
                    }
                    replacement.amountCents = amount.value;
                    replacement.chips = chips.value;
                }

                const now = new Date();
                const op = await createOp(ctx, replacement, req, t);
                const ops = [...ctx.ops.map((o) => (o.id === target.id ? { ...o, voidedAt: now } : o)), op];
                assertConsistent(ctx, ops, (reason) => `This change breaks a later action (${reason})`);
                await db.GameFinanceOp.update(
                    { voidedAt: now, voidedById: req.user.id },
                    { where: { id: target.id }, transaction: t }
                );
                return { id: op.id, duplicate: false };
            });
            const ctx = await loadFinanceContext(req.params.gameId);
            return res.status(result.duplicate ? 200 : 201).json({
                op: historyItem(ctx, result.id),
                duplicate: result.duplicate,
                finance: buildFinanceView(ctx),
            });
        } catch (error) {
            return sendError(res, error, "Error correcting the operation");
        }
    },
};

export default financeController;
