import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    centsToUnits,
    computeFinance,
    computePlayerStats,
    computeRecap,
    formatCents,
    nextSeq,
    parseAmountToCents,
    resultNetCents,
    splitByPercents,
    splitEntry,
    splitKnockout,
    unitsToCents,
} from "../src/utils/finance.utils.js";

// ─── Aides de test ─────────────────────────────────────────────────────

const PLAYERS = ["alice", "bob", "carol", "dave", "eve"].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) }));

// Construit une liste d'opérations numérotées dans l'ordre d'écriture
function opsBuilder() {
    const ops = [];
    let seq = 0;
    const add = (op) => {
        const full = { id: `op${ops.length + 1}`, seq: ++seq, createdAt: new Date(2026, 0, 1, 20, 0, ops.length), ...op };
        ops.push(full);
        return full;
    };
    return {
        ops,
        buyIn: (gamePlayerId, amountCents, chips) => add({ type: "buyin", gamePlayerId, amountCents, chips }),
        rebuy: (gamePlayerId, amountCents) => add({ type: "rebuy", gamePlayerId, amountCents }),
        addOn: (gamePlayerId, amountCents) => add({ type: "addon", gamePlayerId, amountCents }),
        ko: (gamePlayerId, ...eliminatorIds) => add({ type: "knockout", gamePlayerId, eliminatorIds }),
    };
}

const PKO = { pkoEnabled: true, pkoBountyPercent: 50, pkoCashPercent: 50 };
const CLASSIC = { pkoEnabled: false };
const byId = (finance, id) => finance.players.find((p) => p.id === id);

// Somme des nets d'un récap où le prize pool est entièrement distribué
function netSum(finance, prizes) {
    const order = finance.suggestedOrder;
    const results = order.map((id, i) => ({ gamePlayerId: id, rank: i + 1, prizeCents: prizes[i] ?? 0 }));
    return computeRecap(finance, results);
}

// ─── Conversions ───────────────────────────────────────────────────────

describe("money conversions", () => {
    test("parses amounts typed by a user into cents without float errors", () => {
        assert.equal(parseAmountToCents("12"), 1200);
        assert.equal(parseAmountToCents("12.5"), 1250);
        assert.equal(parseAmountToCents("12,05"), 1205);
        assert.equal(parseAmountToCents("0.29"), 29);
        assert.equal(parseAmountToCents(" 7.10 "), 710);
        assert.equal(parseAmountToCents(20), 2000);
        assert.equal(parseAmountToCents("-5"), null);
        assert.equal(parseAmountToCents("1.234"), null);
        assert.equal(parseAmountToCents("abc"), null);
        assert.equal(parseAmountToCents(""), null);
        assert.equal(parseAmountToCents(null), null);
    });

    test("converts legacy whole units both ways", () => {
        assert.equal(unitsToCents(20), 2000);
        assert.throws(() => unitsToCents(2.5));
        assert.equal(centsToUnits(2250), 23); // 22,50 → 23 (colonnes historiques en unités)
        assert.equal(centsToUnits(2249), 22);
        assert.equal(formatCents(2250), "22.50");
        assert.equal(formatCents(5), "0.05");
        assert.equal(formatCents(-1999), "-19.99");
    });
});

// ─── Formules de base ──────────────────────────────────────────────────

describe("entry split", () => {
    test("classic game: the whole entry goes to the prize pool", () => {
        assert.deepEqual(splitEntry(2000, CLASSIC), { prizePoolCents: 2000, bountyCents: 0 });
    });

    test("PKO 50 %: half bounty, half prize pool", () => {
        assert.deepEqual(splitEntry(2000, PKO), { prizePoolCents: 1000, bountyCents: 1000 });
    });

    test("odd cent goes to the prize pool, nothing lost", () => {
        assert.deepEqual(splitEntry(1501, PKO), { prizePoolCents: 751, bountyCents: 750 });
        const s = splitEntry(999, { pkoEnabled: true, pkoBountyPercent: 33 });
        assert.equal(s.bountyCents, 329);
        assert.equal(s.prizePoolCents + s.bountyCents, 999);
    });
});

describe("knockout split", () => {
    test("default 50/50: 10 € bounty → 5 € now, 5 € on the eliminator's head", () => {
        assert.deepEqual(splitKnockout(1000, 50), [{ shareCents: 1000, cashCents: 500, headCents: 500 }]);
    });

    test("other percentages", () => {
        assert.deepEqual(splitKnockout(1000, 25), [{ shareCents: 1000, cashCents: 250, headCents: 750 }]);
        assert.deepEqual(splitKnockout(1000, 100), [{ shareCents: 1000, cashCents: 1000, headCents: 0 }]);
        assert.deepEqual(splitKnockout(1000, 0), [{ shareCents: 1000, cashCents: 0, headCents: 1000 }]);
    });

    test("rounding: cash rounded down, the leftover cent stays on the head", () => {
        assert.deepEqual(splitKnockout(751, 50), [{ shareCents: 751, cashCents: 375, headCents: 376 }]);
    });

    test("split pot: equal shares, leftover cents to the first eliminators picked", () => {
        const parts = splitKnockout(1001, 50, 3);
        assert.deepEqual(parts.map((p) => p.shareCents), [334, 334, 333]);
        assert.equal(parts.reduce((s, p) => s + p.cashCents + p.headCents, 0), 1001);
    });
});

describe("payout split", () => {
    test("percentages of the prize pool, leftover cents to the top places", () => {
        assert.deepEqual(splitByPercents(10000, [70, 30]), [7000, 3000]);
        assert.deepEqual(splitByPercents(1001, [50, 30, 20]), [501, 300, 200]);
        assert.deepEqual(splitByPercents(100, [33.33, 33.33, 33.34]), [34, 33, 33]);
        const amounts = splitByPercents(2250, [60, 40]);
        assert.deepEqual(amounts, [1350, 900]);
    });

    test("no redistribution when the percentages don't add up to 100", () => {
        assert.deepEqual(splitByPercents(1000, [50, 30]), [500, 300]);
    });
});

// ─── Rebuys et add-ons (partie classique) ──────────────────────────────

describe("classic game with rebuys", () => {
    test("buy-ins, several rebuys per player and add-ons stay separate", () => {
        const b = opsBuilder();
        b.buyIn("alice", 2000, 5000);
        b.buyIn("bob", 2000, 5000);
        b.buyIn("carol", 2000, 5000);
        b.rebuy("bob", 2000);
        b.rebuy("bob", 1500); // montant modifié par l'hôte
        b.addOn("alice", 1000);
        b.addOn("bob", 1000);
        const f = computeFinance({ config: CLASSIC, players: PLAYERS, ops: b.ops });

        assert.deepEqual(f.issues, []);
        const bob = byId(f, "bob");
        assert.equal(bob.buyInCents, 2000);
        assert.equal(bob.rebuyCount, 2);
        assert.equal(bob.rebuyCents, 3500);
        assert.equal(bob.addOnCount, 1);
        assert.equal(bob.addOnCents, 1000);
        assert.equal(bob.investedCents, 6500);
        assert.equal(byId(f, "alice").rebuyCount, 0);
        assert.equal(byId(f, "alice").addOnCents, 1000);

        assert.equal(f.totals.investedCents, 11500);
        assert.equal(f.totals.prizePoolCents, 11500); // rebuys et add-ons comptés une seule fois
        assert.equal(f.totals.rebuyCount, 2);
        assert.equal(f.totals.addOnCount, 2);
        assert.equal(f.totals.bountyPoolCents, 0);
        assert.equal(f.totals.seatedCount, 3);
        assert.equal(f.totals.chips, 15000);
    });

    test("a voided rebuy no longer counts, its history stays", () => {
        const b = opsBuilder();
        b.buyIn("alice", 2000);
        const r = b.rebuy("alice", 2000);
        r.voidedAt = new Date();
        const f = computeFinance({ config: CLASSIC, players: PLAYERS, ops: b.ops });
        assert.equal(byId(f, "alice").rebuyCount, 0);
        assert.equal(f.totals.prizePoolCents, 2000);
        assert.equal(f.history.find((h) => h.id === r.id).status, "voided");
    });

    test("a correction replaces the original at the same place in history", () => {
        const b = opsBuilder();
        b.buyIn("alice", 2000);
        const r = b.rebuy("alice", 2000);
        b.rebuy("alice", 2000);
        r.voidedAt = new Date();
        b.ops.push({ id: "fix", seq: r.seq, type: "rebuy", gamePlayerId: "alice", amountCents: 1000, correctsId: r.id, createdAt: new Date(2026, 0, 1, 23) });
        const f = computeFinance({ config: CLASSIC, players: PLAYERS, ops: b.ops });
        assert.equal(byId(f, "alice").rebuyCents, 3000);
        assert.deepEqual(f.history.map((h) => h.id), ["op1", "op2", "fix", "op3"]);
        assert.equal(nextSeq(b.ops), 4);
    });

    test("invalid operations are flagged and have no effect", () => {
        const b = opsBuilder();
        b.buyIn("alice", 2000);
        b.buyIn("alice", 2000); // double buy-in
        b.rebuy("bob", 2000); // pas assis
        b.ko("alice", "bob"); // pas de KO en partie classique
        const f = computeFinance({ config: CLASSIC, players: PLAYERS, ops: [...b.ops, { id: "x", seq: 99, type: "rebuy", gamePlayerId: "ghost", amountCents: 100 }] });
        assert.deepEqual(f.issues.map((i) => i.reason), [
            "Alice already has a buy-in",
            "Bob has no buy-in yet",
            "Knockouts are only tracked in PKO games",
            "Unknown player",
        ]);
        assert.equal(f.totals.investedCents, 2000);
    });

    test("negative or fractional amounts are refused by the replay too", () => {
        const b = opsBuilder();
        b.buyIn("alice", 2000);
        b.rebuy("alice", -500);
        b.rebuy("alice", 10.5);
        const f = computeFinance({ config: CLASSIC, players: PLAYERS, ops: b.ops });
        assert.equal(f.issues.length, 2);
        assert.equal(f.totals.investedCents, 2000);
    });
});

// ─── PKO ───────────────────────────────────────────────────────────────

function pkoTable(...ids) {
    const b = opsBuilder();
    for (const id of ids) b.buyIn(id, 2000);
    return b;
}

describe("PKO knockouts", () => {
    test("example from the spec: 10 € bounty → 5 € now, bounty 10 → 15 €; 15 € used if eliminated next", () => {
        const b = pkoTable("alice", "bob", "carol");
        b.ko("bob", "alice");
        let f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        assert.equal(byId(f, "alice").bountiesWonCents, 500);
        assert.equal(byId(f, "alice").bountyCents, 1500);
        assert.equal(byId(f, "bob").bountyCents, 0);
        assert.equal(byId(f, "bob").alive, false);
        assert.equal(f.totals.aliveCount, 2);
        assert.equal(f.totals.prizePoolCents, 3000);
        assert.equal(f.totals.bountyPoolCents, 3000);

        b.ko("alice", "carol");
        f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        const ko = f.history.at(-1);
        assert.equal(ko.effect.bountyCents, 1500);
        assert.equal(byId(f, "carol").bountiesWonCents, 750);
        assert.equal(byId(f, "carol").bountyCents, 1750);
    });

    test("several knockouts by the same player, then that player is eliminated", () => {
        const b = pkoTable("alice", "bob", "carol", "dave");
        b.ko("bob", "alice"); // A: 500 cash, bounty 1500
        b.ko("carol", "alice"); // A: +500 cash, bounty 2000
        let f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        assert.equal(byId(f, "alice").knockoutCount, 2);
        assert.equal(byId(f, "alice").bountiesWonCents, 1000);
        assert.equal(byId(f, "alice").bountyCents, 2000);

        b.ko("alice", "dave"); // D récupère la bounty accumulée de A
        f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        assert.equal(byId(f, "dave").bountiesWonCents, 1000);
        assert.equal(byId(f, "dave").bountyCents, 2000);
        assert.equal(byId(f, "alice").bountiesWonCents, 1000); // A garde ses gains immédiats
        assert.equal(f.totals.bountiesPaidCents + f.totals.bountiesOnTableCents, f.totals.bountyPoolCents);
    });

    test("custom split percentages", () => {
        const b = opsBuilder();
        b.buyIn("alice", 3000);
        b.buyIn("bob", 3000);
        b.ko("bob", "alice");
        const f = computeFinance({ config: { pkoEnabled: true, pkoBountyPercent: 40, pkoCashPercent: 30 }, players: PLAYERS, ops: b.ops });
        // 30 € : 12 € de bounty, 18 € au prize pool ; KO : 30 % de 12 € = 3,60 € tout de suite, 8,40 € sur la tête
        assert.equal(f.totals.prizePoolCents, 3600);
        assert.equal(byId(f, "alice").bountiesWonCents, 360);
        assert.equal(byId(f, "alice").bountyCents, 1200 + 840);
    });

    test("knockout rules: eliminated must be in, eliminator must be in, nobody twice", () => {
        const b = pkoTable("alice", "bob", "carol");
        b.ko("bob", "alice");
        b.ko("bob", "carol"); // déjà sorti
        b.ko("carol", "bob"); // éliminateur sorti
        b.ko("carol", "carol"); // soi-même
        b.ko("carol"); // personne
        b.ko("carol", "alice", "alice"); // doublon
        b.ko("dave", "alice"); // pas assis
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        assert.deepEqual(f.issues.map((i) => i.reason), [
            "Bob is already out",
            "Bob is out and cannot knock anyone out",
            "A player cannot knock themselves out",
            "Pick who knocked Carol out",
            "The same player was picked twice",
            "Dave has no buy-in yet",
        ]);
    });

    test("split pot elimination: the bounty is shared, no cent lost", () => {
        const b = opsBuilder();
        b.buyIn("alice", 2003);
        b.buyIn("bob", 2000);
        b.buyIn("carol", 2000);
        b.ko("alice", "bob", "carol"); // bounty d'Alice : 1001
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        const [s1, s2] = f.history.at(-1).effect.shares;
        assert.equal(s1.shareCents, 501);
        assert.equal(s2.shareCents, 500);
        assert.equal(byId(f, "bob").bountiesWonCents, 250);
        assert.equal(byId(f, "bob").bountyCents, 1000 + 251);
        assert.equal(byId(f, "carol").bountiesWonCents, 250);
        assert.equal(byId(f, "carol").bountyCents, 1000 + 250);
        assert.equal(f.totals.bountiesPaidCents + f.totals.bountiesOnTableCents, f.totals.bountyPoolCents);
    });

    test("two players knocked out on the same hand by the same winner", () => {
        const b = pkoTable("alice", "bob", "carol");
        b.ko("bob", "alice");
        b.ko("carol", "alice");
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        assert.equal(byId(f, "alice").bountiesWonCents, 1000);
        assert.equal(byId(f, "alice").bountyCents, 2000);
        assert.deepEqual(f.suggestedOrder, ["alice", "carol", "bob"]);
    });
});

describe("PKO rebuys and add-ons", () => {
    test("a rebuy after a knockout starts again with a fresh bounty", () => {
        const b = pkoTable("alice", "bob");
        b.ko("bob", "alice");
        b.rebuy("bob", 2000);
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        const bob = byId(f, "bob");
        assert.equal(bob.alive, true);
        assert.equal(bob.bountyCents, 1000);
        assert.equal(bob.rebuyCount, 1);
        assert.equal(f.totals.prizePoolCents, 3000);
        assert.equal(f.totals.bountyPoolCents, 3000);
    });

    test("rebuy amount uses the same split (custom amount)", () => {
        const b = pkoTable("alice", "bob");
        b.ko("bob", "alice");
        b.rebuy("bob", 1500);
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        assert.equal(byId(f, "bob").bountyCents, 750);
    });

    test("a rebuy without a knockout is refused, an add-on for an eliminated player too", () => {
        const b = pkoTable("alice", "bob");
        b.rebuy("bob", 2000);
        b.ko("bob", "alice");
        b.addOn("bob", 1000);
        b.addOn("alice", 1000);
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        assert.deepEqual(f.issues.map((i) => i.reason), [
            "Bob is still in: record their knockout before the rebuy",
            "Bob is out: an add-on is only for players still in",
        ]);
        assert.equal(byId(f, "alice").addOnCents, 1000);
        assert.equal(byId(f, "alice").bountyCents, 1500 + 500); // l'add-on suit le même partage
    });

    test("a player knocked out, rebuys, and is knocked out again: second bounty is the fresh one", () => {
        const b = pkoTable("alice", "bob", "carol");
        b.ko("bob", "alice");
        b.rebuy("bob", 2000);
        b.ko("bob", "carol");
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        assert.equal(byId(f, "carol").bountiesWonCents, 500);
        assert.equal(byId(f, "bob").timesEliminated, 2);
    });
});

describe("PKO corrections in the middle of the history", () => {
    test("voiding an early knockout recomputes every later bounty", () => {
        const b = pkoTable("alice", "bob", "carol", "dave");
        const first = b.ko("bob", "alice"); // A: bounty 15
        b.ko("alice", "carol"); // C prend 15 → 7,50 cash
        b.ko("carol", "dave");
        first.voidedAt = new Date();
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        assert.deepEqual(f.issues, []);
        assert.equal(byId(f, "bob").alive, true);
        assert.equal(byId(f, "carol").bountiesWonCents, 500); // 10 € et non plus 15 €
        assert.equal(f.totals.bountiesPaidCents + f.totals.bountiesOnTableCents, f.totals.bountyPoolCents);
    });

    test("voiding a knockout that a later rebuy depends on makes the rebuy invalid", () => {
        const b = pkoTable("alice", "bob");
        const ko = b.ko("bob", "alice");
        b.rebuy("bob", 2000);
        ko.voidedAt = new Date();
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        assert.equal(f.issues.length, 1); // l'API refuse donc cette annulation
        assert.match(f.issues[0].reason, /record their knockout/);
    });

    test("changing the eliminator keeps the knockout at the same place", () => {
        const b = pkoTable("alice", "bob", "carol");
        const ko = b.ko("bob", "alice");
        b.ko("carol", "alice");
        ko.voidedAt = new Date();
        b.ops.push({ id: "fix", seq: ko.seq, type: "knockout", gamePlayerId: "bob", eliminatorIds: ["carol"], correctsId: ko.id, createdAt: new Date(2026, 0, 2) });
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops });
        // Rejeu : Carol élimine Bob (Carol : 5 € cash, bounty 15 €), puis Alice élimine Carol
        // et prend donc la bounty grossie de Carol (15 € → 7,50 € cash)
        assert.deepEqual(f.issues, []);
        assert.equal(byId(f, "carol").bountiesWonCents, 500);
        assert.equal(byId(f, "alice").bountiesWonCents, 750);
        assert.equal(byId(f, "alice").bountyCents, 1000 + 750);
    });
});

describe("end of the tournament", () => {
    test("the winner collects their own remaining bounty", () => {
        const b = pkoTable("alice", "bob", "carol");
        b.ko("bob", "alice");
        b.ko("carol", "alice");
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops, finished: true });
        const alice = byId(f, "alice");
        assert.equal(alice.bountiesWonCents, 1000);
        assert.equal(alice.finalBountyCents, 2000);
        assert.equal(alice.bountyCents, 0);
        assert.equal(f.totals.bountiesOnTableCents, 0);
        assert.equal(f.totals.finalBountiesCents, 2000);
        assert.equal(f.totals.bountiesPaidCents + f.totals.finalBountiesCents, f.totals.bountyPoolCents);
    });

    test("game stopped with several players still in: each keeps their own bounty", () => {
        const b = pkoTable("alice", "bob", "carol");
        b.ko("carol", "alice");
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops, finished: true });
        assert.equal(byId(f, "alice").finalBountyCents, 1500);
        assert.equal(byId(f, "bob").finalBountyCents, 1000);
        assert.equal(byId(f, "carol").finalBountyCents, 0);
    });

    test("full recap: invested, prize money, bounties won, final bounty, net — sum of nets is 0", () => {
        const b = pkoTable("alice", "bob", "carol", "dave");
        b.ko("bob", "alice");
        b.rebuy("bob", 2000);
        b.ko("dave", "bob");
        b.ko("carol", "alice");
        b.ko("bob", "alice");
        const f = computeFinance({ config: PKO, players: PLAYERS, ops: b.ops, finished: true });
        assert.equal(f.totals.prizePoolCents, 5000);
        const prizes = splitByPercents(f.totals.prizePoolCents, [70, 30]);
        const recap = netSum(f, prizes);
        const [first, second] = recap.rows;
        assert.equal(first.gamePlayerId, "alice");
        assert.equal(first.prizeCents, 3500);
        assert.equal(second.gamePlayerId, "bob");
        assert.equal(second.rebuyCount, 1);
        assert.equal(second.investedCents, 4000);
        assert.equal(recap.totals.investedCents, 10000);
        assert.equal(recap.totals.receivedCents, 10000);
        assert.equal(recap.totals.netCents, 0);
        assert.equal(recap.balanced, true);
        // Chaque type de gain reste identifiable
        assert.equal(first.receivedCents, first.prizeCents + first.bountiesWonCents + first.finalBountyCents);
        assert.equal(recap.totals.prizeCents + recap.totals.bountyTotalCents, recap.totals.receivedCents);
    });
});

// ─── Invariant : Σ net = 0 sur des parties aléatoires ──────────────────

// Générateur pseudo-aléatoire déterministe (mulberry32) : le test est reproductible
function rng(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test("invariant: money is conserved and the sum of nets is 0 (500 random PKO and classic games)", () => {
    for (let game = 0; game < 500; game++) {
        const rand = rng(game + 1);
        const pick = (arr) => arr[Math.floor(rand() * arr.length)];
        const pko = game % 3 !== 0;
        const config = {
            pkoEnabled: pko,
            pkoBountyPercent: pick([0, 25, 33, 50, 67, 100]),
            pkoCashPercent: pick([0, 33, 50, 75, 100]),
        };
        const players = PLAYERS.slice(0, 2 + Math.floor(rand() * 4));
        const b = opsBuilder();
        for (const p of players) b.buyIn(p.id, 1 + Math.floor(rand() * 5000));

        for (let step = 0; step < 25; step++) {
            const f = computeFinance({ config, players, ops: b.ops });
            assert.deepEqual(f.issues, []);
            const alive = f.players.filter((p) => p.alive);
            const out = f.players.filter((p) => p.seated && !p.alive);
            const action = rand();
            if (pko && action < 0.45 && alive.length > 1) {
                const victim = pick(alive);
                const others = alive.filter((p) => p.id !== victim.id);
                const count = rand() < 0.2 ? Math.min(others.length, 2) : 1;
                b.ko(victim.id, ...others.slice(0, count).map((p) => p.id));
            } else if (action < 0.75) {
                const target = pko ? (out.length ? pick(out) : null) : pick(players);
                if (target) b.rebuy(target.id, Math.floor(rand() * 3000));
            } else if (action < 0.85 && alive.length) {
                b.addOn(pick(alive).id, Math.floor(rand() * 2000));
            } else if (action < 0.95 && b.ops.length > players.length) {
                // Annulation d'une opération au hasard, gardée seulement si l'historique reste cohérent
                const candidate = pick(b.ops.slice(players.length).filter((op) => !op.voidedAt));
                if (candidate) {
                    candidate.voidedAt = new Date();
                    if (computeFinance({ config, players, ops: b.ops }).issues.length) candidate.voidedAt = null;
                }
            }
            const after = computeFinance({ config, players, ops: b.ops });
            assert.equal(after.totals.prizePoolCents + after.totals.bountyPoolCents, after.totals.investedCents);
            assert.equal(after.totals.bountiesPaidCents + after.totals.bountiesOnTableCents, after.totals.bountyPoolCents);
        }

        const final = computeFinance({ config, players, ops: b.ops, finished: true });
        assert.equal(final.totals.bountiesOnTableCents, 0);
        // Pas plus de places payées que de joueurs
        const percents = pick([[100], [70, 30], [50, 30, 20], [33.33, 33.33, 33.34]].filter((p) => p.length <= players.length));
        const prizes = splitByPercents(final.totals.prizePoolCents, percents);
        assert.equal(prizes.reduce((s, x) => s + x, 0), final.totals.prizePoolCents);
        const recap = netSum(final, prizes);
        assert.equal(recap.totals.netCents, 0, `game ${game}: sum of nets must be 0`);
        assert.equal(recap.totals.receivedCents, final.totals.investedCents);
    }
});

// ─── Statistiques : anciennes parties inchangées ───────────────────────

describe("player stats", () => {
    const legacy = [
        { rank: 1, prize: 70, game: { buyIn: 10, placesPaid: 2 } },
        { rank: 3, prize: 0, game: { buyIn: 20, placesPaid: 3 } },
        { rank: 1, prize: 75, game: { buyIn: 15, placesPaid: 2 } },
    ];

    test("old game: net = prize − buy-in, exactly as before", () => {
        for (const r of legacy) {
            assert.equal(resultNetCents(r, r.game), (r.prize - r.game.buyIn) * 100);
        }
        const stats = computePlayerStats(legacy);
        const before = legacy.reduce((s, r) => s + (r.prize - r.game.buyIn), 0); // ancienne formule
        assert.equal(stats.netResult, before);
        assert.equal(Number.isInteger(stats.netResult), true);
        assert.equal(stats.totalGames, 3);
        assert.equal(stats.wins, 2);
        assert.equal(stats.losses, 1);
        assert.equal(stats.paidPlaces, 3);
        assert.equal(stats.rankSum, 5);
        assert.equal(stats.bestStreak, 1);
    });

    test("new game: net = prize money + bounties − everything invested", () => {
        const row = { rank: 1, prize: 23, prizeCents: 2250, bountyCents: 1750, investedCents: 4000, game: { buyIn: 20, placesPaid: 2 } };
        assert.equal(resultNetCents(row, row.game), 0);
        const stats = computePlayerStats([...legacy, row, { ...row, rank: 2, prizeCents: 0, bountyCents: 250, investedCents: 2000 }]);
        assert.equal(stats.netResultCents, (70 - 10 + 0 - 20 + 75 - 15) * 100 + 0 - 1750);
        assert.equal(stats.netResult, 82.5);
        assert.equal(stats.bestStreak, 2);
    });
});
