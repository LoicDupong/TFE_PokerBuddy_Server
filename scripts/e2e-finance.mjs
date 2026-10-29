// E2E de l'API finances (rebuys, add-ons, PKO) contre une API lancée sur une base seedée.
// Usage : API=http://localhost:8103/api node scripts/e2e-finance.mjs
// Crée ses propres parties (à relancer sans risque) ; nécessite les comptes du seed (AceHigh, RiverQueen, ChipMonster).
import { randomUUID } from "node:crypto";

const API = process.env.API || "http://localhost:8103/api";
let passed = 0;
let failed = 0;
const check = (label, cond, extra) => {
    if (cond) { passed++; console.log(`  ✔ ${label}`); }
    else { failed++; console.log(`  ✘ ${label}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ""); }
};
const section = (t) => console.log(`\n## ${t}`);

async function call(method, path, token, body) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* vide */ }
    return { status: res.status, data };
}
const login = async (email, password) => (await call("POST", "/auth/login", null, { email, password })).data;

// Invariants à chaque étape : rien ne se perd entre prize pool, bounties payées et bounties en jeu
function invariants(f, label) {
    const t = f.totals;
    check(`${label}: prize pool + bounty pool = invested`, t.prizePoolCents + t.bountyPoolCents === t.investedCents, t);
    check(`${label}: bounties paid + on table + final = bounty pool`,
        t.bountiesPaidCents + t.bountiesOnTableCents + t.finalBountiesCents === t.bountyPoolCents, t);
    check(`${label}: no issue in history`, f.issues.length === 0, f.issues);
}
const P = (f, id) => f.players.find((p) => p.id === id);

const ace = await login("ace@example.com", "hashedpwd1");
const queen = await login("queen@example.com", "hashedpwd2");
const monster = await login("monster@example.com", "hashedpwd3");
// Stats avant la partie de test : la comparaison reste valable même si le script est relancé
const statsOf = async (who) => (await call("GET", "/user/me", who.token)).data.user.stats;
const before = { ace: await statsOf(ace), queen: await statsOf(queen), monster: await statsOf(monster) };

// ─────────────────────────────────────────────────────────────
section("Create a PKO game (validation + defaults)");
const gameBody = {
    name: "E2E PKO Night", dateStart: new Date(Date.now() - 3600e3).toISOString(), location: "Ace's place",
    buyIn: 20, currency: "EUR", smallBlind: 10, bigBlind: 20, levelDuration: 15, placesPaid: 2,
    payoutDistribution: [{ place: 1, percent: 70 }, { place: 2, percent: 30 }],
    allowRebuys: true, rebuyAmountCents: 2000, pkoEnabled: true, pkoBountyPercent: 50, pkoCashPercent: 50,
    invites: { friends: [{ id: queen.user.id, name: "RiverQueen" }], guests: ["Guesty"], emails: [] },
};
let r = await call("POST", "/games", ace.token, { ...gameBody, pkoBountyPercent: 120 });
check("bounty share 120 % → 400", r.status === 400, r.data);
r = await call("POST", "/games", ace.token, { ...gameBody, pkoCashPercent: 12.5 });
check("cash share 12.5 % → 400", r.status === 400, r.data);
r = await call("POST", "/games", ace.token, { ...gameBody, rebuyAmountCents: -100 });
check("negative rebuy price → 400", r.status === 400, r.data);
r = await call("POST", "/games", ace.token, gameBody);
check("create PKO game → 201", r.status === 201, r.data);
const game = r.data.game;
check("PKO settings stored", game.pkoEnabled === true && game.pkoBountyPercent === 50 && game.pkoCashPercent === 50 && game.rebuyAmountCents === 2000, game);
r = await call("POST", "/games", ace.token, { ...gameBody, name: "E2E default classic", pkoEnabled: undefined, pkoBountyPercent: undefined, pkoCashPercent: undefined, rebuyAmountCents: undefined, invites: undefined });
check("game without PKO fields is classic (pko off, 50/50 defaults, rebuy = buy-in)", r.status === 201 && r.data.game.pkoEnabled === false && r.data.game.rebuyAmountCents === null, r.data);
const classicDefaultId = r.data.game.id;

r = await call("GET", `/games/${game.id}`, ace.token);
const links = r.data.game.playerLinks;
const aceGp = links.find((l) => l.userId === ace.user.id).id;
const queenGp = links.find((l) => l.userId === queen.user.id).id;
const guestGp = links.find((l) => l.guestName === "Guesty").id;

section("Access rules");
r = await call("GET", `/games/${game.id}/finance`, null);
check("no token → 401", r.status === 401, r.data);
r = await call("GET", `/games/${game.id}/finance`, monster.token);
check("non participant GET → 403", r.status === 403, r.data);
r = await call("GET", `/games/${game.id}/finance`, queen.token);
check("player GET → 200, not tracked yet", r.status === 200 && r.data.finance.tracked === false, r.data);
r = await call("POST", `/games/${game.id}/finance/seats`, queen.token, { players: [] });
check("player (non-host) seats → 403", r.status === 403, r.data);
r = await call("GET", `/games/not-a-uuid/finance`, ace.token);
check("bad game id → 404", r.status === 404, r.data);

section("Seats: buy-ins and walk-ins");
const seatList = [
    { key: aceGp, gamePlayerId: aceGp, name: "AceHigh" },
    { key: queenGp, gamePlayerId: queenGp, name: "RiverQueen" },
    { key: guestGp, gamePlayerId: guestGp, name: "Guesty" },
    { key: "walkin-1", gamePlayerId: randomUUID(), name: "  Walky   McWalk " },
];
r = await call("POST", `/games/${game.id}/finance/seats`, ace.token, { players: seatList, chips: 5000 });
check("seats → 200", r.status === 200, r.data);
let f = r.data.finance;
const walkGp = r.data.seats.find((s) => s.key === "walkin-1").gamePlayerId;
check("walk-in got a GamePlayer (name normalised)", r.data.seats.find((s) => s.key === "walkin-1").name === "Walky McWalk", r.data.seats);
check("4 buy-ins of 20 € → invested 80 €, prize pool 40 €, bounty pool 40 €",
    f.totals.investedCents === 8000 && f.totals.prizePoolCents === 4000 && f.totals.bountyPoolCents === 4000 && f.totals.buyInCount === 4, f.totals);
check("each bounty starts at 10 €", f.players.every((p) => p.bountyCents === 1000), f.players);
check("chips recorded (4 × 5000)", f.totals.chips === 20000, f.totals);
invariants(f, "after seats");
r = await call("POST", `/games/${game.id}/finance/seats`, ace.token, { players: seatList.map((s) => (s.key === "walkin-1" ? { ...s, gamePlayerId: walkGp } : s)), chips: 5000 });
check("same seats again → idempotent (still 4 buy-ins)", r.status === 200 && r.data.finance.totals.buyInCount === 4 && r.data.finance.history.length === 4, r.data.finance?.totals);
r = await call("POST", `/games/${game.id}/finance/seats`, ace.token, { players: [...seatList, { key: "walkin-2", name: "Walky McWalk" }] });
check("same walk-in name twice → 400", r.status === 400, r.data);
r = await call("GET", `/games/${game.id}`, ace.token);
check("pending invite seated → accepted, walk-in row is unique", r.data.game.playerLinks.find((l) => l.id === queenGp).status === "accepted"
    && r.data.game.playerLinks.filter((l) => l.guestName === "Walky McWalk").length === 1, r.data.game.playerLinks);

section("Entry validation");
const entry = (body) => call("POST", `/games/${game.id}/finance/entries`, ace.token, body);
r = await entry({ opId: randomUUID(), type: "rebuy", gamePlayerId: walkGp, amountCents: -100 });
check("negative amount → 400", r.status === 400 && /negative/.test(r.data.error), r.data);
r = await entry({ opId: randomUUID(), type: "rebuy", gamePlayerId: walkGp, amountCents: 12.5 });
check("fractional cents → 400", r.status === 400, r.data);
r = await entry({ opId: "nope", type: "rebuy", gamePlayerId: walkGp, amountCents: 2000 });
check("missing/invalid opId → 400", r.status === 400, r.data);
r = await entry({ opId: randomUUID(), type: "bonus", gamePlayerId: walkGp, amountCents: 2000 });
check("unknown type → 400", r.status === 400, r.data);
r = await entry({ opId: randomUUID(), type: "rebuy", gamePlayerId: randomUUID(), amountCents: 2000 });
check("player not in the game → 400", r.status === 400, r.data);
r = await entry({ opId: randomUUID(), type: "rebuy", gamePlayerId: walkGp, amountCents: 2000 });
check("PKO rebuy before a knockout → 409 with explanation", r.status === 409 && /record their knockout/.test(r.data.error), r.data);
r = await call("POST", `/games/${game.id}/finance/entries`, queen.token, { opId: randomUUID(), type: "addon", gamePlayerId: queenGp, amountCents: 1000 });
check("non-host entry → 403", r.status === 403, r.data);

section("Knockouts (50/50) and idempotency");
const ko = (body, token = ace.token) => call("POST", `/games/${game.id}/finance/knockouts`, token, body);
r = await ko({ opId: randomUUID(), eliminatedId: walkGp, eliminatorIds: [walkGp] });
check("self knockout → 400", r.status === 400, r.data);
r = await ko({ opId: randomUUID(), eliminatedId: walkGp, eliminatorIds: [] });
check("no eliminator → 400 (never guessed)", r.status === 400, r.data);
const ko1 = randomUUID();
r = await ko({ opId: ko1, eliminatedId: walkGp, eliminatorIds: [aceGp] });
check("Walky knocked out by Ace → 201", r.status === 201, r.data);
f = r.data.finance;
check("Ace wins 5 € now, bounty 10 → 15 €", P(f, aceGp).bountiesWonCents === 500 && P(f, aceGp).bountyCents === 1500, P(f, aceGp));
check("Walky is out with no bounty", P(f, walkGp).alive === false && P(f, walkGp).bountyCents === 0, P(f, walkGp));
check("KO effect in history", r.data.op.effect.bountyCents === 1000 && r.data.op.effect.shares[0].cashCents === 500, r.data.op);
invariants(f, "after KO 1");
r = await ko({ opId: ko1, eliminatedId: walkGp, eliminatorIds: [aceGp] });
check("same opId resent → 200 duplicate, nothing new", r.status === 200 && r.data.duplicate === true && r.data.finance.totals.knockoutCount === 1, r.data);
r = await ko({ opId: ko1, eliminatedId: queenGp, eliminatorIds: [aceGp] });
check("same opId, other action → 409", r.status === 409, r.data);
r = await ko({ opId: randomUUID(), eliminatedId: walkGp, eliminatorIds: [queenGp] });
check("knocking out a player already out → 409", r.status === 409 && /already out/.test(r.data.error), r.data);
r = await ko({ opId: randomUUID(), eliminatedId: queenGp, eliminatorIds: [walkGp] });
check("eliminator already out → 409", r.status === 409, r.data);

section("Rebuy after a knockout (PKO), parallel double submit");
const rebuyOp = randomUUID();
const burst = await Promise.all(Array.from({ length: 5 }, () => entry({ opId: rebuyOp, type: "rebuy", gamePlayerId: walkGp, amountCents: 2000 })));
check("5 parallel sends of one rebuy → one 201, four 200 duplicates",
    burst.filter((x) => x.status === 201).length === 1 && burst.filter((x) => x.status === 200 && x.data.duplicate).length === 4, burst.map((x) => x.status));
r = await call("GET", `/games/${game.id}/finance`, ace.token);
f = r.data.finance;
check("Walky back in with a fresh 10 € bounty, 1 rebuy", P(f, walkGp).alive && P(f, walkGp).bountyCents === 1000 && P(f, walkGp).rebuyCount === 1, P(f, walkGp));
check("prize pool 50 €, invested 100 €", f.totals.prizePoolCents === 5000 && f.totals.investedCents === 10000, f.totals);
invariants(f, "after rebuy");

section("Successive knockouts, eliminated after collecting bounties");
r = await ko({ opId: randomUUID(), eliminatedId: guestGp, eliminatorIds: [walkGp] });
f = r.data.finance;
check("Guesty out by Walky: Walky +5 €, bounty 15 €", P(f, walkGp).bountiesWonCents === 500 && P(f, walkGp).bountyCents === 1500, P(f, walkGp));
const koWalky2 = await ko({ opId: randomUUID(), eliminatedId: walkGp, eliminatorIds: [aceGp] });
f = koWalky2.data.finance;
check("Walky out again by Ace with his 15 € bounty: Ace +7.50 €, bounty 15 → 22.50 €",
    P(f, aceGp).bountiesWonCents === 1250 && P(f, aceGp).bountyCents === 2250, P(f, aceGp));
invariants(f, "after successive KOs");

section("Undo / correct in the middle of the history");
const guestKo = f.history.find((h) => h.type === "knockout" && h.gamePlayerId === guestGp);
r = await call("POST", `/games/${game.id}/finance/ops/${guestKo.id}/void`, queen.token, {});
check("non-host void → 403", r.status === 403, r.data);
r = await call("POST", `/games/${game.id}/finance/ops/${guestKo.id}/void`, ace.token, {});
check("void Guesty's KO (middle of history) → 200", r.status === 200, r.data);
f = r.data.finance;
check("Guesty back in; Walky only had 10 € when Ace knocked him out → Ace +5 € (total 10 €), bounty 20 €",
    P(f, guestGp).alive && P(f, aceGp).bountiesWonCents === 1000 && P(f, aceGp).bountyCents === 2000 && P(f, walkGp).bountiesWonCents === 0, { ace: P(f, aceGp), walky: P(f, walkGp) });
check("voided KO stays in history", f.history.find((h) => h.id === guestKo.id).status === "voided", f.history);
invariants(f, "after void in the middle");
r = await call("POST", `/games/${game.id}/finance/ops/${guestKo.id}/void`, ace.token, {});
check("void again → 200 (idempotent)", r.status === 200, r.data);
const firstKo = f.history.find((h) => h.opId === ko1);
r = await call("POST", `/games/${game.id}/finance/ops/${firstKo.id}/void`, ace.token, {});
check("void the first KO while the rebuy depends on it → 409", r.status === 409 && /later actions/.test(r.data.error), r.data);
const buyInOp = f.history.find((h) => h.type === "buyin");
r = await call("POST", `/games/${game.id}/finance/ops/${buyInOp.id}/void`, ace.token, {});
check("void a buy-in directly → 400 (use the seats)", r.status === 400, r.data);

// Correction : c'est Guesty (pas Ace) qui a sorti Walky la 2e fois
const walky2 = koWalky2.data.op;
const fixOp = randomUUID();
r = await call("POST", `/games/${game.id}/finance/ops/${walky2.id}/correct`, ace.token, { opId: fixOp, eliminatorIds: [guestGp] });
check("change the eliminator → 201", r.status === 201, r.data);
f = r.data.finance;
check("Guesty now gets Walky's 10 € bounty (5 € + 5 €), Ace back to 15 € bounty",
    P(f, guestGp).bountiesWonCents === 500 && P(f, guestGp).bountyCents === 1500 && P(f, aceGp).bountyCents === 1500 && P(f, aceGp).bountiesWonCents === 500, { ace: P(f, aceGp), guest: P(f, guestGp) });
check("correction keeps its place (same seq) and links the original", r.data.op.seq === walky2.seq && r.data.op.correctsId === walky2.id, r.data.op);
r = await call("POST", `/games/${game.id}/finance/ops/${walky2.id}/correct`, ace.token, { opId: fixOp, eliminatorIds: [guestGp] });
check("correction resent → 200 duplicate", r.status === 200 && r.data.duplicate === true, r.data);
r = await call("POST", `/games/${game.id}/finance/ops/${walky2.id}/correct`, ace.token, { opId: randomUUID(), eliminatorIds: [queenGp] });
check("correcting an already corrected action → 409", r.status === 409, r.data);
invariants(f, "after correction");

section("Add-ons (distinct type) and rebuy correction");
const addOn = await entry({ opId: randomUUID(), type: "addon", gamePlayerId: queenGp, amountCents: 1000, chips: 3000 });
check("add-on → 201", addOn.status === 201, addOn.data);
f = addOn.data.finance;
check("add-on counted apart from rebuys; bounty +5 €", P(f, queenGp).addOnCount === 1 && P(f, queenGp).rebuyCount === 0 && P(f, queenGp).bountyCents === 1500, P(f, queenGp));
r = await entry({ opId: randomUUID(), type: "addon", gamePlayerId: walkGp, amountCents: 1000 });
check("add-on for an eliminated player → 409", r.status === 409, r.data);
const rebuyHist = f.history.find((h) => h.opId === rebuyOp);
r = await call("POST", `/games/${game.id}/finance/ops/${rebuyHist.id}/correct`, ace.token, { opId: randomUUID(), amountCents: -5 });
check("correct with a negative amount → 400", r.status === 400, r.data);
r = await call("POST", `/games/${game.id}/finance/ops/${rebuyHist.id}/correct`, ace.token, { opId: randomUUID(), amountCents: 1500 });
check("rebuy corrected to 15 € → Walky invested 35 €", r.status === 201 && P(r.data.finance, walkGp).investedCents === 3500, r.data);
f = r.data.finance;
invariants(f, "after rebuy correction");

section("Game settings locked once money is in");
r = await call("PATCH", `/games/${game.id}`, ace.token, { buyIn: 30 });
check("change buy-in → 409", r.status === 409, r.data);
r = await call("PATCH", `/games/${game.id}`, ace.token, { pkoCashPercent: 40 });
check("change KO cash share → 409", r.status === 409, r.data);
r = await call("PATCH", `/games/${game.id}`, ace.token, { name: "E2E PKO Night (renamed)", buyIn: 20, pkoEnabled: true, pkoBountyPercent: 50, pkoCashPercent: 50 });
check("other fields (same money values resent) → 200", r.status === 200, r.data);

section("Seat changes during the game");
r = await call("POST", `/games/${game.id}/finance/seats`, ace.token, { players: seatList.filter((s) => s.key !== "walkin-1") });
check("removing a player with rebuys/KOs → 409", r.status === 409 && /can't be removed/.test(r.data.error), r.data);
const allSeats = seatList.map((s) => (s.key === "walkin-1" ? { ...s, gamePlayerId: walkGp } : s));
r = await call("POST", `/games/${game.id}/finance/seats`, ace.token, { players: [...allSeats, { key: "late", name: "Late Larry" }] });
check("late walk-in seated", r.status === 200 && r.data.finance.totals.seatedCount === 5, r.data.finance?.totals);
const lateGp = r.data.seats.find((s) => s.key === "late").gamePlayerId;
r = await call("POST", `/games/${game.id}/finance/seats`, ace.token, { players: allSeats });
check("late walk-in removed again (no other action) → buy-in voided", r.status === 200 && r.data.finance.totals.seatedCount === 4
    && r.data.finance.history.some((h) => h.gamePlayerId === lateGp && h.status === "voided"), r.data.finance?.totals);
f = r.data.finance;
invariants(f, "after seat changes");

section("Results: settlement and final recap");
// État : Ace, Queen, Guesty en jeu ; Walky sorti. Queen sort par Ace, puis Guesty par Ace.
r = await ko({ opId: randomUUID(), eliminatedId: queenGp, eliminatorIds: [aceGp] });
r = await ko({ opId: randomUUID(), eliminatedId: guestGp, eliminatorIds: [aceGp] });
f = r.data.finance;
invariants(f, "before results");
check("suggested order: Ace (still in), Guesty, Queen, Walky", JSON.stringify(f.suggestedOrder) === JSON.stringify([aceGp, guestGp, queenGp, walkGp]), f.suggestedOrder);
const pool = f.totals.prizePoolCents;
const first = Math.floor(pool * 0.7);
const ranking = f.suggestedOrder;
const resultsBody = (prizes) => ({ results: ranking.map((id, i) => ({ gamePlayerId: id, rank: i + 1, prizeCents: prizes[i] ?? 0 })), finishedAt: new Date().toISOString() });
r = await call("POST", `/games/${game.id}/results`, ace.token, resultsBody([first, 1]));
check("prizes not adding up to the prize pool → 400", r.status === 400 && /add up/.test(r.data.error), r.data);
r = await call("POST", `/games/${game.id}/results`, ace.token, { results: ranking.slice(0, 3).map((id, i) => ({ gamePlayerId: id, rank: i + 1, prizeCents: i === 0 ? pool : 0 })) });
check("a player who paid in is missing → 400", r.status === 400 && /missing/.test(r.data.error), r.data);
r = await call("POST", `/games/${game.id}/results`, ace.token, { results: [{ gamePlayerId: aceGp, prizeCents: -1 }] });
check("negative prize → 400", r.status === 400, r.data);
r = await call("POST", `/games/${game.id}/results`, queen.token, resultsBody([first, pool - first]));
check("non-host results → 403", r.status === 403, r.data);
r = await call("POST", `/games/${game.id}/results`, ace.token, resultsBody([first, pool - first]));
check("results → 201", r.status === 201, r.data);
const recap = r.data.finance.recap;
check("recap balanced: Σ net = 0", recap && recap.totals.netCents === 0 && recap.balanced === true, recap?.totals);
check("received = prize money + bounties = invested", recap.totals.receivedCents === r.data.finance.totals.investedCents
    && recap.totals.prizeCents + recap.totals.bountyTotalCents === recap.totals.receivedCents, recap.totals);
const aceRow = recap.rows.find((x) => x.gamePlayerId === aceGp);
check("winner collects their own final bounty", aceRow.finalBountyCents > 0 && aceRow.finalBountyCents === f.players.find((p) => p.id === aceGp).bountyCents, aceRow);
check("each money type identifiable per player", recap.rows.every((x) => x.receivedCents === x.prizeCents + x.bountiesWonCents + x.finalBountyCents && x.netCents === x.receivedCents - x.investedCents), recap.rows);
console.log("    recap:", recap.rows.map((x) => `${x.rank}. ${x.name} invested ${x.investedCents} prize ${x.prizeCents} KO ${x.bountiesWonCents} final ${x.finalBountyCents} net ${x.netCents}`).join(" | "));
const stored = r.data.results;
check("legacy prize column filled (rounded units)", stored.every((x) => x.prize === Math.round(x.prizeCents / 100)), stored);
check("results store invested / bounty cents", stored.every((x) => x.investedCents !== null && x.bountyCents !== null), stored);

r = await entry({ opId: randomUUID(), type: "addon", gamePlayerId: aceGp, amountCents: 1000 });
check("finance locked after results → 409", r.status === 409, r.data);
r = await call("GET", `/games/${game.id}/finance`, queen.token);
check("player can read the final recap", r.status === 200 && r.data.finance.recap?.balanced === true, r.data);

section("Stats after the PKO game");
const nets = Object.fromEntries(recap.rows.map((x) => [x.gamePlayerId, x.netCents]));
const meAce = (await call("GET", "/user/me", ace.token)).data.user.stats;
const meQueen = (await call("GET", "/user/me", queen.token)).data.user.stats;
check("Ace netResult = before + PKO net", meAce.netResultCents === before.ace.netResultCents + nets[aceGp], { now: meAce.netResultCents, before: before.ace.netResultCents, net: nets[aceGp] });
check("Queen netResult = before + PKO net", meQueen.netResultCents === before.queen.netResultCents + nets[queenGp], { now: meQueen, before: before.queen.netResultCents, net: nets[queenGp] });
check("Ace totalGames + 1", meAce.totalGames === before.ace.totalGames + 1, meAce);
const lb = (await call("GET", "/leaderboard?limit=50", ace.token)).data.players;
check("leaderboard uses the same net", lb.find((p) => p.username === "AceHigh").netResultCents === meAce.netResultCents, lb);
const monsterStats = (await call("GET", "/user/me", monster.token)).data.user.stats;
check("player not in the new game: stats unchanged", JSON.stringify(monsterStats) === JSON.stringify(before.monster), monsterStats);

// ─────────────────────────────────────────────────────────────
section("Classic game with rebuys and add-ons");
r = await call("POST", "/games", ace.token, { ...gameBody, name: "E2E Classic Rebuy", buyIn: 15, pkoEnabled: false, rebuyAmountCents: 1000, invites: { friends: [], guests: [], emails: [] } });
const classic = r.data.game;
r = await call("POST", `/games/${classic.id}/finance/seats`, ace.token, { players: [{ key: "a", gamePlayerId: (await call("GET", `/games/${classic.id}`, ace.token)).data.game.playerLinks[0].id, name: "AceHigh" }, { key: "b", name: "Bea" }, { key: "c", name: "Cyril" }] });
check("classic seats → 200", r.status === 200, r.data);
const cs = Object.fromEntries(r.data.seats.map((s) => [s.key, s.gamePlayerId]));
const cEntry = (body) => call("POST", `/games/${classic.id}/finance/entries`, ace.token, body);
await cEntry({ opId: randomUUID(), type: "rebuy", gamePlayerId: cs.b, amountCents: 1000 });
await cEntry({ opId: randomUUID(), type: "rebuy", gamePlayerId: cs.b, amountCents: 1000 });
r = await cEntry({ opId: randomUUID(), type: "addon", gamePlayerId: cs.c, amountCents: 500 });
f = r.data.finance;
check("classic: 2 rebuys for Bea (no knockout needed), add-on apart", P(f, cs.b).rebuyCount === 2 && P(f, cs.b).rebuyCents === 2000 && P(f, cs.c).addOnCents === 500, f.players);
check("classic prize pool = everything paid (45 + 20 + 5 = 70 €), no bounty", f.totals.prizePoolCents === 7000 && f.totals.bountyPoolCents === 0, f.totals);
r = await call("POST", `/games/${classic.id}/finance/knockouts`, ace.token, { opId: randomUUID(), eliminatedId: cs.b, eliminatorIds: [cs.a] });
check("knockout in a classic game → 400", r.status === 400, r.data);
r = await call("POST", `/games/${classic.id}/results`, ace.token, { results: [cs.b, cs.a, cs.c].map((id, i) => ({ gamePlayerId: id, prizeCents: [4900, 2100, 0][i] })) });
check("classic results → 201, Σ net = 0", r.status === 201 && r.data.finance.recap.totals.netCents === 0, r.data.finance?.recap);
check("Bea net = 49 − 35 = +14 €", r.data.finance.recap.rows.find((x) => x.gamePlayerId === cs.b).netCents === 1400, r.data.finance.recap.rows);
const classicAceNet = r.data.finance.recap.rows.find((x) => x.gamePlayerId === cs.a).netCents;
check("Ace net in the classic game = 21 − 15 = +6 €", classicAceNet === 600, classicAceNet);

section("Rebuys off, legacy results flow, deletion");
r = await call("POST", "/games", ace.token, { ...gameBody, name: "E2E Freezeout", allowRebuys: false, pkoEnabled: false, invites: { friends: [], guests: [], emails: [] } });
const freeze = r.data.game;
const freezeHost = (await call("GET", `/games/${freeze.id}`, ace.token)).data.game.playerLinks[0].id;
await call("POST", `/games/${freeze.id}/finance/seats`, ace.token, { players: [{ key: "h", gamePlayerId: freezeHost, name: "AceHigh" }] });
r = await call("POST", `/games/${freeze.id}/finance/entries`, ace.token, { opId: randomUUID(), type: "rebuy", gamePlayerId: freezeHost, amountCents: 2000 });
check("rebuy when rebuys are off → 400", r.status === 400, r.data);
r = await call("DELETE", `/games/${freeze.id}`, ace.token);
check("deleting a game with operations → 200 (operations go with it)", r.status === 200, r.data);

// Ancien flux : résultats sans opérations (prize en unités)
const legacyGame = classicDefaultId;
const legacyHost = (await call("GET", `/games/${legacyGame}`, ace.token)).data.game.playerLinks[0].id;
r = await call("POST", `/games/${legacyGame}/results`, ace.token, { results: [{ gamePlayerId: legacyHost, rank: 1, prize: 20 }, { gamePlayerId: randomUUID(), guestName: "Old Walkin", prize: 0 }] });
check("legacy results (no operations, prize in units) → 201", r.status === 201 && r.data.finance.tracked === false && r.data.finance.recap === null, r.data);
check("legacy result has no cents columns (old formula applies)", r.data.results.every((x) => x.investedCents === null), r.data.results);
const meAce2 = (await call("GET", "/user/me", ace.token)).data.user.stats;
// Ace : partie classique +6 € (21 − 15), partie legacy 20 − 20 = 0
check("classic game (+6 €) and legacy game (prize − buy-in = 0) added to Ace's net", meAce2.netResultCents === meAce.netResultCents + classicAceNet + 0 && meAce2.totalGames === meAce.totalGames + 2, { before: meAce.netResultCents, after: meAce2.netResultCents, classicAceNet });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
