import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/none";
process.env.DB_SSL ??= "false";
process.env.JWT_SECRET ??= "test-secret";
process.env.JWT_ISSUER ??= "test";
process.env.JWT_AUDIENCE ??= "test";

const { default: db } = await import("../src/models/index.js");
const { default: controller } = await import("../src/controllers/adminSupport.controller.js");

function stub(t, target, key, impl) {
    const original = target[key];
    target[key] = impl;
    t.after(() => { target[key] = original; });
}
const fakeRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
};
const makeTicket = (status) => ({
    id: "t1", userId: "u1", subject: "Hello", category: "bug", status, saved: [],
    save: async function (o) { this.saved.push(o); },
});
const tx = { id: "tx" };
const stubTransaction = (t) => stub(t, db.sequelize, "transaction", async (fn) => fn(tx));

describe("admin support audit", () => {
    test("a staff reply writes support.reply in the same transaction, without the message body", async (t) => {
        const ticket = makeTicket("new");
        const logs = [];
        stubTransaction(t);
        stub(t, db.SupportTicket, "findByPk", async () => ticket);
        stub(t, db.SupportMessage, "create", async (v) => ({ id: "m1", ticketId: v.ticketId, isStaff: true, body: v.body, createdAt: new Date() }));
        stub(t, db.AdminAuditLog, "create", async (values, options) => { logs.push({ values, options }); return values; });
        stub(t, db.Notification, "create", async () => ({}));
        const res = fakeRes();
        await controller.addMessage({ params: { id: "t1" }, body: { message: "secret answer" }, user: { id: "a1" } }, res);
        assert.equal(res.statusCode, 201);
        assert.equal(logs.length, 1);
        assert.equal(logs[0].options.transaction, tx);
        assert.equal(logs[0].values.action, "support.reply");
        assert.equal(logs[0].values.targetType, "support_ticket");
        assert.equal(logs[0].values.targetId, "t1");
        assert.equal(logs[0].values.actorId, "a1");
        assert.deepEqual(logs[0].values.details, { messageId: "m1", status: "in_progress" });
        assert.ok(!JSON.stringify(logs[0].values).includes("secret answer"));
    });

    test("a failing audit write fails the reply (nothing is committed without its trace)", async (t) => {
        stubTransaction(t);
        stub(t, db.SupportTicket, "findByPk", async () => makeTicket("new"));
        stub(t, db.SupportMessage, "create", async () => ({ id: "m1", createdAt: new Date() }));
        stub(t, db.AdminAuditLog, "create", async () => { throw new Error("boom"); });
        t.mock?.method(console, "error", () => {});
        const res = fakeRes();
        await controller.addMessage({ params: { id: "t1" }, body: { message: "hi" }, user: { id: "a1" } }, res);
        assert.equal(res.statusCode, 500);
    });

    test("a status change writes support.status with from and to", async (t) => {
        const ticket = makeTicket("in_progress");
        const logs = [];
        stubTransaction(t);
        stub(t, db.SupportTicket, "findByPk", async () => ticket);
        stub(t, db.AdminAuditLog, "create", async (values, options) => { logs.push({ values, options }); return values; });
        const res = fakeRes();
        await controller.updateTicket({ params: { id: "t1" }, body: { status: "resolved" }, user: { id: "a1" } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(ticket.status, "resolved");
        assert.equal(ticket.saved[0].transaction, tx);
        assert.equal(logs[0].options.transaction, tx);
        assert.deepEqual(logs[0].values.details, { from: "in_progress", to: "resolved" });
    });

    test("an unchanged status writes no audit line", async (t) => {
        const logs = [];
        stubTransaction(t);
        stub(t, db.SupportTicket, "findByPk", async () => makeTicket("resolved"));
        stub(t, db.AdminAuditLog, "create", async (v) => { logs.push(v); return v; });
        const res = fakeRes();
        await controller.updateTicket({ params: { id: "t1" }, body: { status: "resolved" }, user: { id: "a1" } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(logs.length, 0);
    });

    test("an invalid status is rejected before any write", async (t) => {
        stub(t, db.SupportTicket, "findByPk", async () => { throw new Error("must not be called"); });
        const res = fakeRes();
        await controller.updateTicket({ params: { id: "t1" }, body: { status: "bogus" }, user: { id: "a1" } }, res);
        assert.equal(res.statusCode, 400);
    });
});
