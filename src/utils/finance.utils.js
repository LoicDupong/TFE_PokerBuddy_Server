// Logique financière d'une partie (rebuys, add-ons, PKO) : fonctions PURES, sans accès à la base
// ni import de models/. Le serveur stocke des opérations (événements) et tout le reste
// (bounties, totaux, récapitulatif) est recalculé en les rejouant dans l'ordre.
//
// Montants : centimes entiers partout (jamais de flottant pour l'argent).
// Règles d'arrondi (aucun centime perdu ni créé, la somme des parts vaut toujours le total) :
// - entrée PKO : part bounty = floor(montant × % bounty / 100), le reste (centime compris) va au prize pool ;
// - KO partagé entre n éliminateurs : floor(bounty / n) chacun, les centimes restants vont un par un
//   aux premiers éliminateurs choisis (ordre de sélection) ;
// - part d'un KO : gain immédiat = floor(part × % immédiat / 100), le reste va dans la bounty de l'éliminateur ;
// - répartition du prize pool en % : floor par place, les centimes restants vont un par un aux
//   premières places payées (1re, puis 2e…).

export const ENTRY_TYPES = ["buyin", "rebuy", "addon"];
export const OP_TYPES = [...ENTRY_TYPES, "knockout"];

// ─── Conversions explicites ─────────────────────────────────────────────

// Montant en centimes valide : entier sûr et positif (0 accepté)
export const isCents = (value) => Number.isSafeInteger(value) && value >= 0;

// Colonnes historiques en unités entières (games.buyIn, game_results.prize) → centimes
export function unitsToCents(units) {
    const n = Number(units);
    if (!Number.isSafeInteger(n)) throw new TypeError(`Not a whole amount: ${units}`);
    return n * 100;
}

// Centimes → unités entières pour remplir les colonnes historiques (affichages et stats existants) :
// arrondi à l'unité la plus proche, 0,50 arrondi vers le haut
export function centsToUnits(cents) {
    return Math.round(cents / 100);
}

// "12", "12.5", "12,50" → 1250 ; null si invalide (négatif, plus de 2 décimales, texte…).
// Analyse de la chaîne plutôt que Number × 100 (0.29 × 100 = 28.999999999999996).
export function parseAmountToCents(value) {
    if (typeof value === "number") {
        if (!Number.isFinite(value) || value < 0) return null;
        value = String(value);
    }
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^(\d+)(?:[.,](\d{1,2}))?$/);
    if (!match) return null;
    const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
    return Number.isSafeInteger(cents) ? cents : null;
}

// 1250 → "12.50" (affichage dans les messages d'erreur de l'API)
export function formatCents(cents) {
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// ─── Formules ──────────────────────────────────────────────────────────

// Partage d'une entrée (buy-in, rebuy ou add-on) entre prize pool classique et bounty.
// Partie classique : tout va au prize pool.
export function splitEntry(amountCents, { pkoEnabled = false, pkoBountyPercent = 0 } = {}) {
    if (!pkoEnabled) return { prizePoolCents: amountCents, bountyCents: 0 };
    const bountyCents = Math.floor((amountCents * pkoBountyPercent) / 100);
    return { prizePoolCents: amountCents - bountyCents, bountyCents };
}

// Bounty d'un joueur éliminé partagée entre ses éliminateurs (1 en général, plusieurs si pot partagé),
// puis chaque part coupée en gain immédiat (cash) et ajout à la bounty de l'éliminateur (head).
export function splitKnockout(bountyCents, cashPercent, eliminatorCount = 1) {
    const n = Math.max(1, eliminatorCount);
    const base = Math.floor(bountyCents / n);
    const extra = bountyCents - base * n;
    return Array.from({ length: n }, (_, i) => {
        const shareCents = base + (i < extra ? 1 : 0);
        const cashCents = Math.floor((shareCents * cashPercent) / 100);
        return { shareCents, cashCents, headCents: shareCents - cashCents };
    });
}

// Répartition d'un montant selon des pourcentages (payoutDistribution).
// Les centimes d'arrondi ne sont redistribués que si les % font bien 100.
export function splitByPercents(totalCents, percents) {
    const amounts = percents.map((p) => Math.floor((totalCents * (Number(p) || 0)) / 100 + 1e-9));
    const sumPercents = percents.reduce((s, p) => s + (Number(p) || 0), 0);
    if (Math.abs(sumPercents - 100) > 0.01) return amounts;
    let left = totalCents - amounts.reduce((s, a) => s + a, 0);
    for (let i = 0; left > 0 && amounts.length > 0; i = (i + 1) % amounts.length) {
        if ((Number(percents[i]) || 0) > 0) {
            amounts[i] += 1;
            left -= 1;
        }
    }
    return amounts;
}

// Ordre de rejeu : numéro de séquence (une correction reprend celui de l'opération corrigée),
// puis date de création, puis id (ordre total et stable)
export function sortOps(ops) {
    return [...ops].sort((a, b) =>
        a.seq - b.seq
        || new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0)
        || String(a.id).localeCompare(String(b.id))
    );
}

export const nextSeq = (ops) => ops.reduce((max, op) => Math.max(max, op.seq ?? 0), 0) + 1;

// ─── Rejeu des opérations ──────────────────────────────────────────────

const newPlayerState = (p, order) => ({
    id: p.id,
    name: p.name ?? "Player",
    seatOrder: order,
    seated: false,
    eliminated: false,
    buyInCents: 0,
    rebuyCount: 0,
    rebuyCents: 0,
    addOnCount: 0,
    addOnCents: 0,
    investedCents: 0,
    chips: 0,
    bountyCents: 0,
    bountiesWonCents: 0,
    knockoutCount: 0,
    timesEliminated: 0,
    eliminationOrder: null,
    finalBountyCents: 0,
});

/**
 * Rejoue les opérations non annulées dans l'ordre et calcule l'état financier de la partie.
 * Une opération incohérente à son tour (joueur inconnu, KO d'un joueur déjà sorti…) est marquée
 * "invalid" et n'a aucun effet : l'API refuse toute écriture qui en produirait une.
 *
 * @param {object} input
 * @param {{ pkoEnabled?: boolean, pkoBountyPercent?: number, pkoCashPercent?: number }} input.config
 * @param {{ id: string, name?: string }[]} input.players joueurs de la partie (game_players)
 * @param {object[]} input.ops opérations { id, seq, type, gamePlayerId, amountCents, chips, eliminatorIds, voidedAt, correctsId, createdAt }
 * @param {boolean} [input.finished] partie terminée : les joueurs encore en jeu encaissent leur propre bounty
 */
export function computeFinance({ config = {}, players = [], ops = [], finished = false }) {
    const pko = !!config.pkoEnabled;
    const cashPercent = Number(config.pkoCashPercent ?? 50);
    const state = new Map(players.map((p, i) => [p.id, newPlayerState(p, i)]));
    const nameOf = (id) => state.get(id)?.name ?? "Unknown player";
    const alive = (p) => p.seated && !p.eliminated;

    const totals = {
        investedCents: 0,
        buyInCents: 0,
        rebuyCents: 0,
        addOnCents: 0,
        buyInCount: 0,
        rebuyCount: 0,
        addOnCount: 0,
        prizePoolCents: 0,
        bountyPoolCents: 0,
        bountiesPaidCents: 0,
        bountiesOnTableCents: 0,
        finalBountiesCents: 0,
        knockoutCount: 0,
        seatedCount: 0,
        aliveCount: 0,
        chips: 0,
    };
    const history = [];
    const issues = [];
    let eliminations = 0;

    // Effet d'une opération, ou message d'erreur (en anglais : renvoyé tel quel par l'API)
    const apply = (op) => {
        const player = state.get(op.gamePlayerId);
        if (!player) return { error: "Unknown player" };

        if (ENTRY_TYPES.includes(op.type)) {
            if (!isCents(op.amountCents)) return { error: "Amount must be a positive number of cents" };
            if (op.chips != null && !isCents(op.chips)) return { error: "Chips must be a positive whole number" };
            if (op.type === "buyin" && player.seated) return { error: `${player.name} already has a buy-in` };
            if (op.type !== "buyin" && !player.seated) return { error: `${player.name} has no buy-in yet` };
            // PKO : un rebuy suit un KO (bounty repartie de zéro), un add-on ne concerne qu'un joueur encore en jeu
            if (pko && op.type === "rebuy" && !player.eliminated) {
                return { error: `${player.name} is still in: record their knockout before the rebuy` };
            }
            if (pko && op.type === "addon" && player.eliminated) {
                return { error: `${player.name} is out: an add-on is only for players still in` };
            }

            const split = splitEntry(op.amountCents, config);
            player.investedCents += op.amountCents;
            player.bountyCents += split.bountyCents;
            player.chips += op.chips ?? 0;
            totals.investedCents += op.amountCents;
            totals.prizePoolCents += split.prizePoolCents;
            totals.bountyPoolCents += split.bountyCents;
            totals.chips += op.chips ?? 0;
            if (op.type === "buyin") {
                player.seated = true;
                player.buyInCents += op.amountCents;
                totals.buyInCents += op.amountCents;
                totals.buyInCount += 1;
            } else if (op.type === "rebuy") {
                player.eliminated = false;
                player.rebuyCount += 1;
                player.rebuyCents += op.amountCents;
                totals.rebuyCents += op.amountCents;
                totals.rebuyCount += 1;
            } else {
                player.addOnCount += 1;
                player.addOnCents += op.amountCents;
                totals.addOnCents += op.amountCents;
                totals.addOnCount += 1;
            }
            return { effect: { amountCents: op.amountCents, ...split } };
        }

        if (op.type === "knockout") {
            if (!pko) return { error: "Knockouts are only tracked in PKO games" };
            const ids = Array.isArray(op.eliminatorIds) ? op.eliminatorIds : [];
            if (ids.length === 0) return { error: `Pick who knocked ${player.name} out` };
            if (new Set(ids).size !== ids.length) return { error: "The same player was picked twice" };
            if (!alive(player)) {
                return { error: player.seated ? `${player.name} is already out` : `${player.name} has no buy-in yet` };
            }
            const winners = [];
            for (const id of ids) {
                if (id === player.id) return { error: "A player cannot knock themselves out" };
                const winner = state.get(id);
                if (!winner) return { error: "Unknown player" };
                if (!alive(winner)) return { error: `${winner.name} is out and cannot knock anyone out` };
                winners.push(winner);
            }

            const bountyCents = player.bountyCents;
            const parts = splitKnockout(bountyCents, cashPercent, winners.length);
            player.bountyCents = 0;
            player.eliminated = true;
            player.timesEliminated += 1;
            player.eliminationOrder = ++eliminations;
            const shares = winners.map((winner, i) => {
                winner.bountiesWonCents += parts[i].cashCents;
                winner.bountyCents += parts[i].headCents;
                winner.knockoutCount += 1;
                totals.bountiesPaidCents += parts[i].cashCents;
                return { gamePlayerId: winner.id, name: winner.name, ...parts[i], bountyAfterCents: winner.bountyCents };
            });
            totals.knockoutCount += 1;
            return { effect: { bountyCents, shares } };
        }

        return { error: "Unknown operation" };
    };

    for (const op of sortOps(ops)) {
        const base = {
            id: op.id,
            opId: op.opId ?? null,
            seq: op.seq,
            type: op.type,
            gamePlayerId: op.gamePlayerId,
            playerName: nameOf(op.gamePlayerId),
            amountCents: op.amountCents ?? null,
            chips: op.chips ?? null,
            eliminatorIds: op.eliminatorIds ?? null,
            correctsId: op.correctsId ?? null,
            createdAt: op.createdAt ?? null,
            voidedAt: op.voidedAt ?? null,
        };
        if (op.voidedAt) {
            history.push({ ...base, status: "voided", effect: null });
            continue;
        }
        const { error, effect } = apply(op);
        if (error) {
            history.push({ ...base, status: "invalid", reason: error, effect: null });
            issues.push({ id: op.id, opId: op.opId ?? null, reason: error });
        } else {
            history.push({ ...base, status: "active", effect });
        }
    }

    // Fin de partie : chaque joueur encore en jeu encaisse sa propre bounty
    // (normalement seul le vainqueur ; plusieurs si l'hôte arrête la partie avant le dernier KO)
    const list = [...state.values()];
    for (const p of list) {
        if (finished && alive(p) && p.bountyCents > 0) {
            p.finalBountyCents = p.bountyCents;
            p.bountyCents = 0;
            totals.finalBountiesCents += p.finalBountyCents;
        }
        if (p.seated) totals.seatedCount += 1;
        if (alive(p)) totals.aliveCount += 1;
        totals.bountiesOnTableCents += p.bountyCents;
    }

    // Classement suggéré en fin de partie : joueurs encore en jeu, puis du dernier éliminé au premier
    const suggestedOrder = list
        .filter((p) => p.seated)
        .sort((a, b) => {
            if (alive(a) !== alive(b)) return alive(a) ? -1 : 1;
            if (alive(a)) return a.seatOrder - b.seatOrder;
            return b.eliminationOrder - a.eliminationOrder;
        })
        .map((p) => p.id);

    return {
        pko,
        players: list.map((p) => ({ ...p, alive: alive(p) })),
        totals,
        history,
        issues,
        suggestedOrder,
    };
}

/**
 * Récapitulatif final par joueur : investi (buy-in, rebuys, add-ons), reçu (prize money,
 * bounties gagnées en cours de partie, bounty finale), net = reçu − investi.
 * @param {ReturnType<typeof computeFinance>} finance état calculé avec finished = true
 * @param {{ gamePlayerId: string, rank: number, prizeCents: number, name?: string }[]} results
 */
export function computeRecap(finance, results) {
    const byId = new Map(finance.players.map((p) => [p.id, p]));
    const rows = results.map((r) => {
        const p = byId.get(r.gamePlayerId);
        const prizeCents = r.prizeCents ?? 0;
        const bountiesWonCents = p?.bountiesWonCents ?? 0;
        const finalBountyCents = p?.finalBountyCents ?? 0;
        const investedCents = p?.investedCents ?? 0;
        const receivedCents = prizeCents + bountiesWonCents + finalBountyCents;
        return {
            gamePlayerId: r.gamePlayerId,
            name: p?.name ?? r.name ?? "Player",
            rank: r.rank,
            buyInCents: p?.buyInCents ?? 0,
            rebuyCount: p?.rebuyCount ?? 0,
            rebuyCents: p?.rebuyCents ?? 0,
            addOnCount: p?.addOnCount ?? 0,
            addOnCents: p?.addOnCents ?? 0,
            investedCents,
            prizeCents,
            bountiesWonCents,
            finalBountyCents,
            bountyTotalCents: bountiesWonCents + finalBountyCents,
            knockoutCount: p?.knockoutCount ?? 0,
            receivedCents,
            netCents: receivedCents - investedCents,
        };
    }).sort((a, b) => a.rank - b.rank);

    const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
    const totals = {
        investedCents: sum("investedCents"),
        buyInCents: sum("buyInCents"),
        rebuyCents: sum("rebuyCents"),
        addOnCents: sum("addOnCents"),
        prizeCents: sum("prizeCents"),
        bountiesWonCents: sum("bountiesWonCents"),
        finalBountyCents: sum("finalBountyCents"),
        bountyTotalCents: sum("bountyTotalCents"),
        receivedCents: sum("receivedCents"),
        netCents: sum("netCents"),
    };
    return { rows, totals, balanced: totals.netCents === 0 };
}

// ─── Statistiques ──────────────────────────────────────────────────────

/**
 * Net d'un résultat en centimes. Ancienne partie (investedCents null) : prize − buy-in, comme avant.
 * Nouvelle partie : prize money + bounties − total investi (buy-in + rebuys + add-ons).
 */
export function resultNetCents(result, game) {
    if (result.investedCents == null) {
        return unitsToCents(result.prize ?? 0) - unitsToCents(game?.buyIn ?? 0);
    }
    const prizeCents = result.prizeCents ?? unitsToCents(result.prize ?? 0);
    return prizeCents + (result.bountyCents ?? 0) - result.investedCents;
}

/**
 * Statistiques d'un joueur à partir de ses résultats de parties terminées, triés par date de fin.
 * @param {{ rank: number, prize: number, prizeCents?: number|null, bountyCents?: number|null, investedCents?: number|null, game: { buyIn: number, placesPaid: number } }[]} results
 */
export function computePlayerStats(results) {
    const totalGames = results.length;
    const wins = results.filter((r) => r.rank === 1).length;
    const paidPlaces = results.filter((r) => r.rank <= r.game.placesPaid).length;
    const rankSum = results.reduce((s, r) => s + r.rank, 0);
    const netResultCents = results.reduce((s, r) => s + resultNetCents(r, r.game), 0);

    let bestStreak = 0;
    let current = 0;
    for (const r of results) {
        if (r.rank === 1) {
            current += 1;
            bestStreak = Math.max(bestStreak, current);
        } else {
            current = 0;
        }
    }

    return {
        totalGames,
        wins,
        losses: totalGames - wins,
        paidPlaces,
        rankSum,
        // Unités (comme avant) : entier pour les anciennes parties, 2 décimales max sinon
        netResult: netResultCents / 100,
        netResultCents,
        bestStreak,
    };
}
