// E2E du back-office (/api/admin) contre une API lancée sur une base de dev seedée et migrée.
// Usage : API=http://localhost:8106/api node scripts/e2e-admin.mjs
// Crée ses propres comptes (suffixe aléatoire, IP simulée par X-Forwarded-For) : à relancer sans risque.
// Le premier admin est promu par scripts/grant-admin.mjs (ENV_FILE, défaut .env.local : même base que l'API).
// Les scénarios « dernier admin » ne sont joués que si aucun autre admin actif n'existe (base fraîchement seedée).
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const API = process.env.API || "http://localhost:8106/api";
const ENV_FILE = process.env.ENV_FILE || ".env.local";
const FAKE_IP = `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250) + 1).join(".")}`;
const SUFFIX = randomBytes(3).toString("hex");
const PASSWORD = "E2eAdmin42";
const SENSITIVE = /password|tokenVersion|passwordResetTokenHash/;

let passed = 0;
let failed = 0;
let skipped = 0;
const check = (label, cond, extra) => {
    if (cond) { passed++; console.log(`  ✔ ${label}`); }
    else { failed++; console.log(`  ✘ ${label}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ""); }
};
const skip = (label) => { skipped++; console.log(`  – ${label} (skipped)`); };
const section = (t) => console.log(`\n## ${t}`);

async function call(method, path, token, body) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": FAKE_IP,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* vide */ }
    return { status: res.status, data };
}
const login = (email, password = PASSWORD) => call("POST", "/auth/login", null, { email, password });

async function register(prefix) {
    const username = `${prefix}${SUFFIX}`;
    const email = `${prefix.toLowerCase()}.${SUFFIX}@e2e.example.com`;
    const r = await call("POST", "/auth/register", null, { username, email, password: PASSWORD });
    if (r.status !== 201) throw new Error(`register ${username} failed: ${r.status} ${JSON.stringify(r.data)}`);
    return { ...r.data.user, email, token: r.data.token };
}

async function grant(...args) {
    try {
        const { stdout } = await promisify(execFile)(process.execPath, [`--env-file=${ENV_FILE}`, "scripts/grant-admin.mjs", ...args]);
        return { code: 0, out: stdout };
    } catch (error) {
        return { code: error.code, out: `${error.stdout}${error.stderr}` };
    }
}
const lastLine = (out) => out.split("\n").filter((l) => l && !l.startsWith("Executing")).pop() ?? "";
const noSecrets = (value) => !SENSITIVE.test(JSON.stringify(value));
const NIL = "00000000-0000-4000-8000-000000000000";

// ─────────────────────────────────────────────────────────────
section("Setup: accounts and first admin (grant-admin script)");
const adminA = await register("AdmA");
const adminB = await register("AdmB");
const userU = await register("UsrU");
const userV = await register("UsrV");
const hostH = await register("HstH");
check("5 accounts registered", true);

let g = await grant("--username", adminA.username, "--email", userU.email);
check("grant: username and email of different accounts → exit 1", g.code === 1 && /No account matches/.test(g.out), lastLine(g.out));
g = await grant("--username", adminA.username, "--email", adminA.email, "--dry-run");
check("grant --dry-run → exit 0, nothing changed", g.code === 0 && /Dry run/.test(g.out), lastLine(g.out));
let r = await call("GET", "/admin/users", adminA.token);
check("still 403 after dry run", r.status === 403, r.status);
g = await grant("--username", adminA.username.toLowerCase(), "--email", adminA.email.toUpperCase());
check("grant (case-insensitive) → exit 0, now admin", g.code === 0 && /is now an admin/.test(g.out), lastLine(g.out));
g = await grant("--username", adminA.username, "--email", adminA.email);
check("grant again → idempotent, exit 0", g.code === 0 && /already an admin/.test(g.out), lastLine(g.out));
r = await call("GET", "/auth/me", adminA.token);
check("existing token keeps working after promotion, role = admin", r.status === 200 && r.data.user?.role === "admin", r.data);

// ─────────────────────────────────────────────────────────────
section("Access control (401 / 403 / 404)");
for (const path of ["/admin/users", "/admin/games", "/admin/audit-logs", `/admin/users/${userU.id}`]) {
    r = await call("GET", path, null);
    check(`GET ${path.replace(userU.id, ":id")} without token → 401`, r.status === 401, r.status);
    r = await call("GET", path, userU.token);
    check(`GET ${path.replace(userU.id, ":id")} as user → 403`, r.status === 403, r.status);
}
r = await call("POST", `/admin/users/${userV.id}/disable`, userU.token, {});
check("POST disable as user → 403", r.status === 403, r.status);
r = await call("DELETE", `/admin/users/${userV.id}`, userU.token);
check("DELETE user as user → 403", r.status === 403, r.status);
r = await call("GET", "/admin/users/not-a-uuid", adminA.token);
check("malformed id → 404", r.status === 404, r.status);
r = await call("GET", `/admin/users/${NIL}`, adminA.token);
check("unknown user → 404 USER_NOT_FOUND", r.status === 404 && r.data?.code === "USER_NOT_FOUND", r.data);

// ─────────────────────────────────────────────────────────────
section("List and detail of users");
r = await call("GET", `/admin/users?q=${SUFFIX}`, adminA.token);
check("search by suffix → 5 accounts, pagination shape", r.status === 200 && r.data.total === 5 && r.data.page === 1 && r.data.pageSize === 20 && r.data.items.length === 5, r.data);
check("list never exposes password / tokenVersion / reset hash", noSecrets(r.data));
check("list items have status and email", r.data.items.every((u) => u.status === "active" && u.email), r.data.items?.[0]);
r = await call("GET", `/admin/users?q=${SUFFIX}&pageSize=2&page=3`, adminA.token);
check("page 3 of size 2 → 1 item, total 5", r.status === 200 && r.data.items.length === 1 && r.data.total === 5 && r.data.page === 3, r.data);
r = await call("GET", "/admin/users?pageSize=500", adminA.token);
check("pageSize capped at 100", r.status === 200 && r.data.pageSize === 100, r.data?.pageSize);
r = await call("GET", `/admin/users?q=${encodeURIComponent(userV.email)}`, adminA.token);
check("search by email", r.status === 200 && r.data.total === 1 && r.data.items[0].id === userV.id, r.data);
r = await call("GET", `/admin/users?q=${SUFFIX}&role=admin`, adminA.token);
check("role=admin filter", r.status === 200 && r.data.total === 1 && r.data.items[0].id === adminA.id, r.data);
r = await call("GET", "/admin/users?status=banned", adminA.token);
check("invalid status → 400 INVALID_STATUS", r.status === 400 && r.data?.code === "INVALID_STATUS", r.data);
r = await call("GET", "/admin/users?role=root", adminA.token);
check("invalid role filter → 400", r.status === 400, r.data);
r = await call("GET", `/admin/users/${userV.id}`, adminA.token);
check("detail with counters", r.status === 200 && r.data.user.counts && r.data.user.counts.gamesHosted === 0 && r.data.user.counts.friends === 0, r.data);
check("detail never exposes secrets", noSecrets(r.data));

// ─────────────────────────────────────────────────────────────
section("Roles and last admin guard");
r = await call("GET", "/admin/users?role=admin&status=active&pageSize=100", adminA.token);
const aloneAdmin = r.status === 200 && r.data.total === 1;
if (aloneAdmin) {
    r = await call("PATCH", `/admin/users/${adminA.id}/role`, adminA.token, { role: "user" });
    check("last active admin demoting themself → 400 LAST_ADMIN", r.status === 400 && r.data?.code === "LAST_ADMIN", r.data);
    r = await call("DELETE", "/user/me", adminA.token, { password: PASSWORD });
    check("last active admin deleting their account → 400 LAST_ADMIN", r.status === 400 && r.data?.code === "LAST_ADMIN", r.data);
} else {
    skip(`last admin guard (${r.data?.total} active admins in this database)`);
}
r = await call("PATCH", `/admin/users/${adminB.id}/role`, adminA.token, { role: "superuser" });
check("invalid role → 400 INVALID_ROLE", r.status === 400 && r.data?.code === "INVALID_ROLE", r.data);
r = await call("PATCH", `/admin/users/${adminB.id}/role`, adminA.token, { role: "admin" });
check("promote B → 200 changed", r.status === 200 && r.data.changed === true && r.data.user.role === "admin", r.data);
r = await call("PATCH", `/admin/users/${adminB.id}/role`, adminA.token, { role: "admin" });
check("promote B again → 200 unchanged", r.status === 200 && r.data.changed === false, r.data);
r = await call("GET", "/admin/users", adminB.token);
check("B's existing token now has admin access (role read from the database)", r.status === 200, r.status);

if (aloneAdmin) {
    // Deux admins qui se rétrogradent en même temps : le verrou consultatif n'en laisse passer qu'un
    const [ra, rb] = await Promise.all([
        call("PATCH", `/admin/users/${adminA.id}/role`, adminA.token, { role: "user" }),
        call("PATCH", `/admin/users/${adminB.id}/role`, adminB.token, { role: "user" }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    check("concurrent self-demotion of the 2 last admins → one 200, one 400 LAST_ADMIN",
        statuses[0] === 200 && statuses[1] === 400 && [ra, rb].some((x) => x.data?.code === "LAST_ADMIN"), [ra.data, rb.data]);
    // Remise en place : l'admin restant repromeut l'autre, puis tout le monde se reconnecte
    const remaining = ra.status === 400 ? adminA : adminB;
    const demoted = remaining === adminA ? adminB : adminA;
    r = await call("GET", "/admin/users", demoted.token);
    check("demoted admin's token is revoked → 401", r.status === 401, r.status);
    r = await call("PATCH", `/admin/users/${demoted.id}/role`, remaining.token, { role: "admin" });
    check("remaining admin promotes the other back", r.status === 200 && r.data.changed, r.data);
    demoted.token = (await login(demoted.email)).data.token;
} else {
    skip("concurrent self-demotion");
}
r = await call("PATCH", `/admin/users/${adminB.id}/role`, adminA.token, { role: "user" });
check("demote B (A remains) → 200", r.status === 200 && r.data.user.role === "user", r.data);
r = await call("GET", "/auth/me", adminB.token);
check("demotion revokes B's sessions → 401", r.status === 401, r.status);
adminB.token = (await login(adminB.email)).data.token;
r = await call("GET", "/admin/users", adminB.token);
check("B logged in again → 403 on admin", r.status === 403, r.status);
r = await call("PATCH", `/admin/users/${adminB.id}/role`, adminA.token, { role: "admin" });
check("promote B again for the next steps", r.status === 200 && r.data.changed, r.data);

// ─────────────────────────────────────────────────────────────
section("Disable / enable");
r = await call("POST", `/admin/users/${adminA.id}/disable`, adminA.token, {});
check("disable yourself → 400 SELF_ACTION", r.status === 400 && r.data?.code === "SELF_ACTION", r.data);
r = await call("POST", `/admin/users/${userU.id}/disable`, adminA.token, { reason: 123 });
check("non-string reason → 400", r.status === 400, r.data);
r = await call("POST", `/admin/users/${userU.id}/disable`, adminA.token, { reason: "x".repeat(501) });
check("reason > 500 chars → 400", r.status === 400, r.data);
const oldTokenU = userU.token;
r = await call("POST", `/admin/users/${userU.id}/disable`, adminA.token, { reason: "Spam reports" });
check("disable U → 200, status disabled", r.status === 200 && r.data.changed && r.data.user.status === "disabled", r.data);
r = await call("GET", "/auth/me", oldTokenU);
check("U's token → 401", r.status === 401, r.status);
r = await login(userU.email);
check("U login → 403 disabled", r.status === 403, r.data);
r = await call("POST", `/admin/users/${userU.id}/disable`, adminA.token, {});
check("disable U again → 200 unchanged", r.status === 200 && r.data.changed === false, r.data);
r = await call("GET", `/admin/users/${userU.id}`, adminA.token);
check("detail shows the disable reason", r.status === 200 && r.data.user.disabledReason === "Spam reports", r.data);
r = await call("GET", `/user/search?username=UsrU${SUFFIX}`, userV.token);
check("disabled account hidden from player search", r.status === 200 && r.data.users.length === 0, r.data);
r = await call("POST", "/friends/invite", userV.token, { friendId: userU.id });
check("friend request to a disabled account → 404", r.status === 404, r.data);

r = await call("POST", "/games", hostH.token, {
    name: `E2E Admin ${SUFFIX}`, dateStart: new Date(Date.now() + 86400e3).toISOString(), location: "Host's place",
    buyIn: 10, currency: "EUR", smallBlind: 10, bigBlind: 20, levelDuration: 15, placesPaid: 1,
    payoutDistribution: [{ place: 1, percent: 100 }],
});
check("host creates a pending game", r.status === 201, r.data);
const gameH = r.data.game;
r = await call("POST", `/games/${gameH.id}/invites`, hostH.token, { userId: userU.id });
check("game invite of a disabled account → 404", r.status === 404, r.data);
r = await call("POST", `/games/${gameH.id}/invites`, hostH.token, { userId: "nope" });
check("game invite with a malformed id → 404 (not 500)", r.status === 404, r.data);
r = await call("POST", `/games/${gameH.id}/invites`, hostH.token, { userId: userV.id });
check("game invite of an active account → 201", r.status === 201, r.data);

r = await call("POST", `/admin/users/${adminB.id}/disable`, adminA.token, {});
check("disable another admin (A remains) → 200", r.status === 200 && r.data.changed, r.data);
r = await call("GET", "/admin/users", adminB.token);
check("disabled admin → 401", r.status === 401, r.status);
r = await call("POST", `/admin/users/${adminB.id}/enable`, adminA.token);
check("enable B → 200", r.status === 200 && r.data.user.status === "active", r.data);
adminB.token = (await login(adminB.email)).data?.token;
r = await call("GET", "/admin/users", adminB.token);
check("B logs in again and is still admin", r.status === 200, r.status);

r = await call("POST", `/admin/users/${userU.id}/enable`, adminA.token);
check("enable U → 200 active", r.status === 200 && r.data.changed && r.data.user.status === "active", r.data);
r = await call("POST", `/admin/users/${userU.id}/enable`, adminA.token);
check("enable U again → 200 unchanged", r.status === 200 && r.data.changed === false, r.data);
r = await call("GET", "/auth/me", oldTokenU);
check("U's old token stays revoked after enable", r.status === 401, r.status);
r = await login(userU.email);
check("U can log in again", r.status === 200, r.data);
userU.token = r.data.token;

// ─────────────────────────────────────────────────────────────
section("Revoke sessions");
const oldTokenV = userV.token;
r = await call("POST", `/admin/users/${userV.id}/revoke-sessions`, adminA.token);
check("revoke V's sessions → 200, no token returned for someone else", r.status === 200 && r.data.token === undefined, r.data);
r = await call("GET", "/auth/me", oldTokenV);
check("V's token → 401", r.status === 401, r.status);
userV.token = (await login(userV.email)).data.token;
const oldTokenA = adminA.token;
r = await call("POST", `/admin/users/${adminA.id}/revoke-sessions`, adminA.token);
check("revoke your own sessions → 200 with a new token", r.status === 200 && typeof r.data.token === "string", r.data);
adminA.token = r.data.token;
check("old token → 401, new token → 200",
    (await call("GET", "/auth/me", oldTokenA)).status === 401 && (await call("GET", "/admin/users", adminA.token)).status === 200);

// ─────────────────────────────────────────────────────────────
section("Games: list, detail, cancel");
r = await call("GET", `/admin/games?q=${SUFFIX}`, adminA.token);
check("list games by name → 1 pending game with host and players count",
    r.status === 200 && r.data.total === 1 && r.data.items[0].host?.id === hostH.id && r.data.items[0].playersCount >= 1, r.data);
r = await call("GET", "/admin/games?status=open", adminA.token);
check("invalid status → 400", r.status === 400, r.data);
r = await call("GET", `/admin/games/${gameH.id}`, adminA.token);
check("game detail: host, players, results, finance summary",
    r.status === 200 && r.data.game.host.id === hostH.id && r.data.game.players.some((p) => p.userId === userV.id)
    && Array.isArray(r.data.game.results) && r.data.game.finance && "totals" in r.data.game.finance, r.data);
check("game detail never exposes secrets", noSecrets(r.data));
r = await call("GET", `/admin/games/${NIL}`, adminA.token);
check("unknown game → 404", r.status === 404, r.data);

r = await call("GET", "/admin/games?status=finished&pageSize=1", adminA.token);
const finishedGame = r.data?.items?.[0];
if (finishedGame) {
    r = await call("POST", `/admin/games/${finishedGame.id}/cancel`, adminA.token, {});
    check("cancel a finished game → 400 GAME_FINISHED", r.status === 400 && r.data?.code === "GAME_FINISHED", r.data);
    r = await call("GET", `/admin/games/${finishedGame.id}`, adminA.token);
    check("finished game still there", r.status === 200, r.status);
} else {
    skip("cancel a finished game (no finished game in this database)");
}

r = await call("POST", `/admin/games/${gameH.id}/cancel`, adminA.token, { reason: "Duplicate game" });
check("cancel the pending game → 200, host and invitee notified", r.status === 200 && r.data.notified === 2, r.data);
r = await call("GET", `/games/${gameH.id}`, hostH.token);
check("game is gone → 404", r.status === 404, r.status);
r = await call("POST", `/admin/games/${gameH.id}/cancel`, adminA.token, {});
check("cancel again → 404", r.status === 404, r.data);
for (const [who, label] of [[userV, "invitee"], [hostH, "host"]]) {
    r = await call("GET", "/notifications", who.token);
    const list = Array.isArray(r.data) ? r.data : (r.data?.notifications ?? []);
    const cancelled = list.filter((n) => n.type === "game_cancelled" && n.message.includes(SUFFIX));
    check(`${label} got game_cancelled (no link), invite notification removed`,
        cancelled.length === 1 && cancelled[0].referenceId === null && !list.some((n) => n.referenceId === gameH.id), list);
}

// ─────────────────────────────────────────────────────────────
section("Delete an account (deleteAccount)");
r = await call("POST", "/games", userU.token, {
    name: `E2E U game ${SUFFIX}`, dateStart: new Date(Date.now() + 86400e3).toISOString(), location: "U's place",
    buyIn: 10, currency: "EUR", smallBlind: 10, bigBlind: 20, levelDuration: 15, placesPaid: 1,
    payoutDistribution: [{ place: 1, percent: 100 }],
});
const gameU = r.data?.game;
await call("POST", `/games/${gameU?.id}/invites`, userU.token, { userId: userV.id });
r = await call("POST", "/friends/invite", userV.token, { friendId: userU.id });
check("U has a pending game with V invited, and a friend request from V", !!gameU && r.status < 300, r.data);

r = await call("DELETE", `/admin/users/${adminA.id}`, adminA.token);
check("delete yourself via admin → 400 SELF_ACTION", r.status === 400 && r.data?.code === "SELF_ACTION", r.data);
r = await call("DELETE", `/admin/users/${NIL}`, adminA.token);
check("delete unknown → 404", r.status === 404, r.data);
r = await call("DELETE", `/admin/users/${userU.id}`, adminA.token);
check("delete U → 200 with non-sensitive counters (1 cancelled game, 1 friendship)",
    r.status === 200 && r.data.cancelledGames === 1 && r.data.removedFriendships === 1 && noSecrets(r.data), r.data);
r = await call("GET", "/auth/me", userU.token);
check("U's token → 401", r.status === 401, r.status);
r = await call("GET", `/user/${userU.id}`, userV.token);
check("public profile of a deleted account → 404", r.status === 404, r.data);
r = await call("GET", `/games/${gameU?.id}`, userV.token);
check("U's pending game was cancelled", r.status === 404, r.status);
r = await call("GET", "/notifications", userV.token);
const vList = Array.isArray(r.data) ? r.data : (r.data?.notifications ?? []);
check("V notified that U's game was cancelled", vList.some((n) => n.type === "game_cancelled" && n.message.includes(`E2E U game ${SUFFIX}`) && /deleted their account/.test(n.message)), vList);
r = await call("GET", `/admin/users/${userU.id}`, adminA.token);
check("admin detail: status deleted, anonymized", r.status === 200 && r.data.user.status === "deleted" && r.data.user.username.startsWith("deleted_"), r.data);
r = await call("DELETE", `/admin/users/${userU.id}`, adminA.token);
check("delete again → 400 ALREADY_DELETED", r.status === 400 && r.data?.code === "ALREADY_DELETED", r.data);
for (const [method, path, body] of [
    ["POST", `/admin/users/${userU.id}/disable`, {}],
    ["POST", `/admin/users/${userU.id}/enable`, undefined],
    ["POST", `/admin/users/${userU.id}/revoke-sessions`, undefined],
    ["PATCH", `/admin/users/${userU.id}/role`, { role: "admin" }],
]) {
    r = await call(method, path, adminA.token, body);
    check(`${method} ${path.split("/").slice(-1)[0]} on a deleted account → 400 ALREADY_DELETED`, r.status === 400 && r.data?.code === "ALREADY_DELETED", r.data);
}
r = await call("GET", `/admin/users?q=${SUFFIX}&status=deleted`, adminA.token);
check("status=deleted filter", r.status === 200 && r.data.total === 0, r.data); // pseudo anonymisé : plus de suffixe
r = await call("GET", `/admin/users/${userU.id}`, adminA.token);
check("deleted account found by id", r.data?.user?.status === "deleted");
r = await call("POST", "/friends/invite", userV.token, { friendId: userU.id });
check("friend request to a deleted account → 404", r.status === 404, r.data);
r = await call("POST", "/games", hostH.token, {
    name: `E2E Admin 2 ${SUFFIX}`, dateStart: new Date(Date.now() + 86400e3).toISOString(), location: "Host's place",
    buyIn: 10, currency: "EUR", smallBlind: 10, bigBlind: 20, levelDuration: 15, placesPaid: 1,
    payoutDistribution: [{ place: 1, percent: 100 }],
});
const gameH2 = r.data?.game;
r = await call("POST", `/games/${gameH2?.id}/invites`, hostH.token, { userId: userU.id });
check("game invite of a deleted account → 404", r.status === 404, r.data);
await call("DELETE", `/games/${gameH2?.id}`, hostH.token);

// ─────────────────────────────────────────────────────────────
section("Audit log");
r = await call("GET", `/admin/audit-logs?targetType=user&targetId=${userU.id}`, adminA.token);
const actionsU = (r.data?.items ?? []).map((l) => l.action);
check("U's audit trail: disable, enable, delete (newest first)",
    r.status === 200 && JSON.stringify(actionsU) === JSON.stringify(["user.delete", "user.enable", "user.disable"]), actionsU);
check("audit entries carry the actor (id, username) and no secrets",
    (r.data?.items ?? []).every((l) => l.actor?.id === adminA.id && l.actor.username === adminA.username) && noSecrets(r.data), r.data.items?.[0]);
check("disable entry keeps the reason", r.data?.items?.find((l) => l.action === "user.disable")?.details?.reason === "Spam reports");
r = await call("GET", `/admin/audit-logs?targetType=game&targetId=${gameH.id}`, adminA.token);
check("game.cancel entry with reason and notified count",
    r.status === 200 && r.data.total === 1 && r.data.items[0].action === "game.cancel" && r.data.items[0].details.reason === "Duplicate game" && r.data.items[0].details.notified === 2, r.data);
r = await call("GET", `/admin/audit-logs?targetType=user&targetId=${adminA.id}&action=user.role`, adminA.token);
check("script promotion logged with via=script, actor = promoted account",
    r.status === 200 && r.data.items.some((l) => l.details?.via === "script" && l.actorId === adminA.id), r.data);
r = await call("GET", `/admin/audit-logs?actorId=${adminA.id}&pageSize=5`, adminA.token);
check("filter by actor, paginated", r.status === 200 && r.data.items.length === 5 && r.data.total > 5 && r.data.items.every((l) => l.actorId === adminA.id), r.data?.total);
r = await call("GET", "/admin/audit-logs?actorId=abc", adminA.token);
check("invalid actorId → 400", r.status === 400, r.data);
r = await call("GET", "/admin/audit-logs?targetType=user&targetId=" + userV.id, adminA.token);
check("revoke-sessions logged", r.data?.items?.some((l) => l.action === "user.revoke_sessions"), r.data);

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exitCode = failed ? 1 : 0;
