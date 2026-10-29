// Accès base des finances de partie : chargement des opérations et construction de la vue renvoyée
// par l'API. Les calculs eux-mêmes sont dans finance.utils.js (pur, testé sans base).
import db from "../models/index.js";
import { computeFinance, computeRecap, unitsToCents } from "./finance.utils.js";

// Erreur métier : le contrôleur la traduit en réponse { error } avec son code HTTP
export class FinanceError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Nom affiché d'un joueur de la partie (compte, pseudo mémorisé ou invité)
export const playerName = (gp) => gp.user?.username || gp.userName || gp.guestName || "Player";

// Réglages financiers de la partie, en centimes
export function financeConfig(game) {
    const buyInCents = unitsToCents(game.buyIn ?? 0);
    return {
        buyInCents,
        allowRebuys: !!game.allowRebuys,
        // Prix proposé pour un rebuy ou un add-on (modifiable à chaque saisie)
        rebuyAmountCents: game.rebuyAmountCents ?? buyInCents,
        pkoEnabled: !!game.pkoEnabled,
        pkoBountyPercent: game.pkoBountyPercent ?? 50,
        pkoCashPercent: game.pkoCashPercent ?? 50,
    };
}

// Opération telle que la lit finance.utils.js
export const toPlainOp = (op) => ({
    id: op.id,
    opId: op.opId,
    seq: op.seq,
    type: op.type,
    gamePlayerId: op.gamePlayerId,
    amountCents: op.amountCents,
    chips: op.chips,
    eliminatorIds: op.eliminatorIds,
    correctsId: op.correctsId,
    voidedAt: op.voidedAt,
    createdAt: op.createdAt,
});

/**
 * Charge tout ce qu'il faut pour rejouer les finances d'une partie.
 * Avec { transaction, lock: true } la ligne de la partie est verrouillée (FOR UPDATE) :
 * les écritures concurrentes sur une même partie passent l'une après l'autre.
 */
export async function loadFinanceContext(gameId, { transaction, lock = false } = {}) {
    const game = await db.Game.findByPk(gameId, {
        transaction,
        ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
    });
    if (!game) return null;

    const [gamePlayers, ops, results] = await Promise.all([
        db.GamePlayer.findAll({
            where: { gameId },
            include: [{ model: db.User, as: "user", attributes: ["id", "username"] }],
            order: [["createdAt", "ASC"], ["id", "ASC"]],
            transaction,
        }),
        db.GameFinanceOp.findAll({ where: { gameId }, transaction }),
        db.GameResult.findAll({ where: { gameId }, transaction }),
    ]);

    return { game, gamePlayers, ops: ops.map(toPlainOp), results };
}

// Rejoue les opérations ; la partie compte comme terminée dès que ses résultats sont saisis
export function replay(ctx, ops = ctx.ops, { finished = ctx.results.length > 0 } = {}) {
    return computeFinance({
        config: financeConfig(ctx.game),
        players: ctx.gamePlayers.map((gp) => ({ id: gp.id, name: playerName(gp) })),
        ops,
        finished,
    });
}

export const hasActiveOps = (ops) => ops.some((op) => !op.voidedAt);

/**
 * Vue renvoyée par GET /games/:gameId/finance et après chaque écriture.
 * recap : renseigné une fois les résultats saisis (investi, prize money, bounties, net par joueur).
 */
export function buildFinanceView(ctx) {
    const finance = replay(ctx);
    const locked = ctx.results.length > 0;
    const userIds = new Map(ctx.gamePlayers.map((gp) => [gp.id, gp.userId ?? null]));

    let recap = null;
    if (locked && hasActiveOps(ctx.ops)) {
        recap = computeRecap(finance, ctx.results.map((r) => ({
            gamePlayerId: r.gamePlayerId,
            rank: r.rank,
            prizeCents: r.prizeCents ?? unitsToCents(r.prize ?? 0),
        })));
        for (const row of recap.rows) row.userId = userIds.get(row.gamePlayerId) ?? null;
    }

    return {
        gameId: ctx.game.id,
        status: ctx.game.status,
        currency: ctx.game.currency,
        // Partie suivie par les opérations (sinon : ancienne partie ou session sans Game Manager)
        tracked: hasActiveOps(ctx.ops),
        // Résultats saisis : plus aucune opération possible
        locked,
        config: financeConfig(ctx.game),
        players: finance.players
            .filter((p) => p.seated)
            .map(({ seatOrder, ...p }) => ({ ...p, userId: userIds.get(p.id) ?? null })),
        totals: finance.totals,
        history: finance.history,
        issues: finance.issues,
        suggestedOrder: finance.suggestedOrder,
        recap,
    };
}
