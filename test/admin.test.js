import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// Aucun accès réel à la base : models/index.js exige DATABASE_URL mais ne se connecte qu'à la
// première requête ; les méthodes utilisées sont remplacées par des doublures dans chaque test.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/none";
process.env.DB_SSL ??= "false";
process.env.JWT_SECRET ??= "test-secret";
process.env.JWT_ISSUER ??= "test";
process.env.JWT_AUDIENCE ??= "test";

const { default: db } = await import("../src/models/index.js");
const { requireAdmin, authMiddleware } = await import("../src/middlewares/auth.middleware.js");
const { assertNotLastActiveAdmin, cancelUnfinishedGames, AccountError } = await import("../src/utils/account.utils.js");
const { logAdminAction, sanitizeAuditDetails } = await import("../src/utils/adminAudit.utils.js");
const { generateToken } = await import("../src/utils/jwt.utils.js");
const { default: adminRouter } = await import("../src/routers/admin.route.js");
const {
    parsePagination, userStatus, validateReason, decideGrant, parseGrantArgs,
} = await import("../src/utils/admin.utils.js");

// Remplace temporairement des méthodes de db (restaurées après le test)
function stub(t, target, key, impl) {
    const original = target[key];
    target[key] = impl;
    t.after(() => { target[key] = original; });
}

const fakeRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};

describe("requireAdmin", () => {
    const run = (user) => {
        const res = fakeRes();
        let nextCalled = false;
        requireAdmin()({ user }, res, () => { nextCalled = true; });
        return { res, nextCalled };
    };
    test("401 when not logged in", () => {
        const { res, nextCalled } = run(null);
        assert.equal(res.statusCode, 401);
        assert.equal(nextCalled, false);
    });
    test("403 for a regular user", () => {
        const { res, nextCalled } = run({ id: "u1", role: "user" });
        assert.equal(res.statusCode, 403);
        assert.equal(nextCalled, false);
    });
    test("passes for an admin", () => {
        assert.equal(run({ id: "a1", role: "admin" }).nextCalled, true);
    });
});

describe("authMiddleware (role and session read from the database)", () => {
    const authenticate = async (t, row, tokenUser = { id: "a1", username: "Boss", tokenVersion: 2 }) => {
        stub(t, db.User, "findByPk", async () => row);
        const req = { headers: { authorization: `Bearer ${await generateToken(tokenUser)}` } };
        await new Promise((resolve, reject) => authMiddleware()(req, {}, (err) => (err ? reject(err) : resolve())));
        return req.user;
    };
    const admin = { id: "a1", username: "Boss", role: "admin", tokenVersion: 2, disabledAt: null, deletedAt: null };

    test("role comes from the database", async (t) => {
        assert.deepEqual(await authenticate(t, admin), { id: "a1", username: "Boss", role: "admin" });
        assert.equal((await authenticate(t, { ...admin, role: "user" })).role, "user");
    });
    test("disabled account → no user", async (t) => {
        assert.equal(await authenticate(t, { ...admin, disabledAt: new Date() }), null);
    });
    test("revoked sessions (tokenVersion bumped) → no user", async (t) => {
        assert.equal(await authenticate(t, { ...admin, tokenVersion: 3 }), null);
    });
    test("deleted account → no user", async (t) => {
        assert.equal(await authenticate(t, { ...admin, deletedAt: new Date() }), null);
    });
});

describe("admin router: every route is behind requireAdmin", () => {
    let server;
    let base;
    let currentUser = null;
    before(async () => {
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => { req.user = currentUser; next(); });
        app.use("/admin", adminRouter);
        server = app.listen(0);
        await new Promise((resolve) => server.once("listening", resolve));
        base = `http://127.0.0.1:${server.address().port}/admin`;
    });
    after(() => server.close());

    const id = "00000000-0000-4000-8000-000000000000";
    const routes = [
        ["GET", "/users"], ["GET", `/users/${id}`], ["PATCH", `/users/${id}/role`], ["POST", `/users/${id}/disable`],
        ["POST", `/users/${id}/enable`], ["POST", `/users/${id}/revoke-sessions`], ["DELETE", `/users/${id}`],
        ["GET", "/games"], ["GET", `/games/${id}`], ["POST", `/games/${id}/cancel`], ["GET", "/audit-logs"],
        ["GET", "/users/not-a-uuid"],
    ];
    test("401 without a session, 403 for a regular user", async () => {
        for (const [method, path] of routes) {
            currentUser = null;
            let res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
            assert.equal(res.status, 401, `${method} ${path}`);
            currentUser = { id: "u1", username: "Joe", role: "user" };
            res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
            assert.equal(res.status, 403, `${method} ${path}`);
        }
    });
});

describe("assertNotLastActiveAdmin", () => {
    const setup = (t, otherAdmins) => {
        const calls = { lock: 0, where: null };
        stub(t, db.sequelize, "query", async (sql) => { if (/pg_advisory_xact_lock/.test(sql)) calls.lock++; });
        stub(t, db.User, "count", async ({ where }) => { calls.where = where; return otherAdmins; });
        return calls;
    };
    test("refuses to remove the last active admin", async (t) => {
        const calls = setup(t, 0);
        await assert.rejects(
            assertNotLastActiveAdmin({ id: "a1", role: "admin", disabledAt: null, deletedAt: null }, {}),
            (error) => error instanceof AccountError && error.code === "LAST_ADMIN"
        );
        assert.equal(calls.lock, 1, "serialized by the advisory lock");
        assert.equal(calls.where.deletedAt, null);
        assert.equal(calls.where.disabledAt, null, "a disabled admin does not count");
    });
    test("passes when another active admin exists", async (t) => {
        setup(t, 1);
        await assertNotLastActiveAdmin({ id: "a1", role: "admin", disabledAt: null, deletedAt: null }, {});
    });
    test("ignores regular users and already disabled admins (no lock taken)", async (t) => {
        const calls = setup(t, 0);
        await assertNotLastActiveAdmin({ id: "u1", role: "user" }, {});
        await assertNotLastActiveAdmin({ id: "a2", role: "admin", disabledAt: new Date() }, {});
        assert.equal(calls.lock, 0);
    });
});

describe("cancelUnfinishedGames", () => {
    test("notifies host and pending/accepted players once, skips deleted accounts and the excluded user", async (t) => {
        const destroyed = {};
        stub(t, db.GamePlayer, "findAll", async () => [
            { gameId: "g1", userId: "h1" }, // l'hôte est aussi joueur : une seule notification
            { gameId: "g1", userId: "p1" },
            { gameId: "g1", userId: "gone" },
            { gameId: "g1", userId: "self" },
        ]);
        stub(t, db.User, "findAll", async ({ where }) => where.id[Object.getOwnPropertySymbols(where.id)[0]]
            .filter((id) => id !== "gone").map((id) => ({ id })));
        stub(t, db.Notification, "destroy", async ({ where }) => { destroyed.notifications = where; return 3; });
        stub(t, db.Game, "destroy", async ({ where }) => { destroyed.games = where; return 1; });

        const result = await cancelUnfinishedGames([{ id: "g1", name: "Night", hostId: "h1" }], { transaction: {}, excludeUserId: "self" });
        assert.deepEqual(result.recipients.map((r) => r.userId).sort(), ["h1", "p1"]);
        assert.equal(result.removedNotifications, 3);
        assert.deepEqual(result.games, [{ id: "g1", name: "Night" }]);
        assert.ok(destroyed.games && destroyed.notifications, "game and its notifications removed");
    });
    test("does nothing without games", async () => {
        assert.deepEqual(await cancelUnfinishedGames([], { transaction: {} }), { games: [], recipients: [], removedNotifications: 0 });
    });
});

describe("audit log", () => {
    test("sanitizeAuditDetails drops secrets at any depth and truncates strings", () => {
        const clean = sanitizeAuditDetails({
            reason: "x".repeat(600),
            password: "p", tokenVersion: 3, passwordResetTokenHash: "h",
            nested: { token: "t", ok: 1, list: [{ secret: "s", keep: true }] },
            skip: undefined,
        });
        assert.equal(clean.reason.length, 500);
        assert.deepEqual(Object.keys(clean).sort(), ["nested", "reason"]);
        assert.deepEqual(clean.nested, { ok: 1, list: [{ keep: true }] });
        assert.equal(sanitizeAuditDetails(null), null);
    });
    test("logAdminAction writes in the caller's transaction with sanitized details", async (t) => {
        let created;
        stub(t, db.AdminAuditLog, "create", async (values, options) => { created = { values, options }; return values; });
        const transaction = { id: "tx" };
        await logAdminAction({ actorId: "a1", action: "user.disable", targetType: "user", targetId: 42, details: { reason: "spam", password: "x" } }, { transaction });
        assert.equal(created.options.transaction, transaction);
        assert.deepEqual(created.values, { actorId: "a1", action: "user.disable", targetType: "user", targetId: "42", details: { reason: "spam" } });
    });
});

describe("admin helpers", () => {
    test("parsePagination: defaults, cap at 100, invalid values", () => {
        assert.deepEqual(parsePagination({}), { page: 1, pageSize: 20, q: "", limit: 20, offset: 0 });
        assert.equal(parsePagination({ pageSize: "500" }).pageSize, 100);
        assert.deepEqual(parsePagination({ page: "3", pageSize: "10", q: "  ace " }), { page: 3, pageSize: 10, q: "ace", limit: 10, offset: 20 });
        assert.equal(parsePagination({ page: "-2", pageSize: "abc" }).page, 1);
        assert.equal(parsePagination({ page: "1.5" }).page, 1);
        assert.equal(parsePagination({ q: ["a", "b"] }).q, "");
    });
    test("userStatus", () => {
        assert.equal(userStatus({}), "active");
        assert.equal(userStatus({ disabledAt: new Date() }), "disabled");
        assert.equal(userStatus({ disabledAt: new Date(), deletedAt: new Date() }), "deleted");
    });
    test("validateReason", () => {
        assert.equal(validateReason(undefined), null);
        assert.equal(validateReason("Spam"), null);
        assert.ok(validateReason(12));
        assert.ok(validateReason("x".repeat(501)));
    });
});

describe("grant-admin decision (script is idempotent and needs username AND email of one account)", () => {
    const user = { id: "u1", role: "user", deletedAt: null, disabledAt: null };
    test("grant when both lookups find the same active user", () => {
        assert.deepEqual(decideGrant(user, { ...user }), { action: "grant", userId: "u1" });
    });
    test("already admin → no change (idempotent)", () => {
        assert.equal(decideGrant({ ...user, role: "admin" }, { ...user, role: "admin" }).action, "already_admin");
    });
    test("username and email of two different accounts → mismatch", () => {
        assert.equal(decideGrant(user, { ...user, id: "u2" }).action, "mismatch");
    });
    test("unknown username or email → not_found", () => {
        assert.equal(decideGrant(null, user).action, "not_found");
        assert.equal(decideGrant(user, null).action, "not_found");
    });
    test("deleted or disabled account → inactive", () => {
        assert.equal(decideGrant({ ...user, disabledAt: new Date() }, { ...user, disabledAt: new Date() }).action, "inactive");
        assert.equal(decideGrant({ ...user, deletedAt: new Date() }, { ...user, deletedAt: new Date() }).action, "inactive");
    });
    test("parseGrantArgs", () => {
        assert.deepEqual(parseGrantArgs(["--username", "Seven", "--email", "a@b.c", "--dry-run"]), { username: "Seven", email: "a@b.c", dryRun: true });
        assert.deepEqual(parseGrantArgs(["--username=Seven", "--email=a@b.c"]), { username: "Seven", email: "a@b.c", dryRun: false });
        assert.deepEqual(parseGrantArgs(["--username", "--email", "a@b.c"]), { username: null, email: "a@b.c", dryRun: false });
        assert.deepEqual(parseGrantArgs([]), { username: null, email: null, dryRun: false });
    });
});
