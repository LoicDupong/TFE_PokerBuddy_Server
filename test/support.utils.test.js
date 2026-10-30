import { test } from "node:test";
import assert from "node:assert/strict";
import {
    MESSAGE_MAX, SUBJECT_MAX, buildTicketMail, escapeLike, parsePagination, toMessageView, validateMessageBody, validateTicketInput,
} from "../src/utils/support.utils.js";

test("validateTicketInput trims and accepts a valid ticket", () => {
    const { value, error } = validateTicketInput({ category: "bug", subject: "  Crash  ", message: "  It crashes  " });
    assert.equal(error, undefined);
    assert.deepEqual(value, { category: "bug", subject: "Crash", body: "It crashes" });
});

test("validateTicketInput rejects bad category, blank and oversized fields", () => {
    assert.equal(validateTicketInput({ category: "nope", subject: "a", message: "b" }).error, "Invalid category");
    assert.equal(validateTicketInput({ category: "bug", subject: "   ", message: "b" }).error, "Subject is required");
    assert.match(validateTicketInput({ category: "bug", subject: "a".repeat(SUBJECT_MAX + 1), message: "b" }).error, /at most 120/);
    assert.equal(validateTicketInput({ category: "bug", subject: "a", message: 42 }).error, "Message is required");
    assert.match(validateMessageBody("a".repeat(MESSAGE_MAX + 1)).error, /at most 4000/);
    assert.equal(validateTicketInput(undefined).error, "Invalid category");
});

test("parsePagination clamps page and pageSize", () => {
    assert.deepEqual(parsePagination({}), { page: 1, pageSize: 20, offset: 0 });
    assert.deepEqual(parsePagination({ page: "3", pageSize: "50" }), { page: 3, pageSize: 50, offset: 100 });
    assert.equal(parsePagination({ pageSize: "5000" }).pageSize, 100);
    assert.equal(parsePagination({ page: "-4", pageSize: "abc" }).page, 1);
});

test("escapeLike neutralises wildcards", () => {
    assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
});

test("buildTicketMail escapes HTML from user content", () => {
    const mail = buildTicketMail({ ticket: { id: "t1", category: "bug", subject: "<b>x</b>" }, username: "Ace", body: "<script>alert(1)</script>" });
    assert.ok(!mail.html.includes("<script>"));
    assert.ok(mail.html.includes("&lt;script&gt;"));
    assert.ok(mail.text.includes("Ticket: t1"));
});

test("toMessageView hides the author for users and shows it for admins", () => {
    const message = { id: "m", isStaff: true, body: "hi", createdAt: "d", author: { id: "u", username: "Queen", email: "x" } };
    assert.equal(toMessageView(message).author, undefined);
    assert.deepEqual(toMessageView(message, { forAdmin: true }).author, { id: "u", username: "Queen" });
});
