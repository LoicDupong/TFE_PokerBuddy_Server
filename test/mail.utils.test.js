import { test } from "node:test";
import assert from "node:assert/strict";
import { maskEmail, sendMail } from "../src/utils/mail.utils.js";

const MAIL = {
    to: "ace@example.com",
    subject: "Reset your PokerBuddy password",
    html: "<p>Hi</p>",
    text: "Reset link: http://localhost:3102/auth/reset-password?token=abc",
};

test("sendMail without SMTP_URL in dev: prints the email (with its link) and resolves", async (t) => {
    const log = t.mock.method(console, "log", () => {});
    const result = await sendMail(MAIL, { NODE_ENV: "dev" });

    assert.deepEqual(result, { delivered: false });
    assert.equal(log.mock.callCount(), 1);
    const output = log.mock.calls[0].arguments[0];
    assert.ok(output.includes("To: ace@example.com"));
    assert.ok(output.includes(`Subject: ${MAIL.subject}`));
    assert.ok(output.includes("token=abc"));
});

test("sendMail without SMTP_URL outside dev: resolves but never logs the content", async (t) => {
    const log = t.mock.method(console, "log", () => {});
    const error = t.mock.method(console, "error", () => {});
    const result = await sendMail(MAIL, { NODE_ENV: "production" });

    assert.deepEqual(result, { delivered: false });
    assert.equal(log.mock.callCount(), 0);
    const output = error.mock.calls.map((c) => c.arguments.join(" ")).join("\n");
    assert.doesNotMatch(output, /token=|ace@example\.com/);
    assert.match(output, /SMTP_URL is not set/);
});

test("maskEmail", () => {
    assert.equal(maskEmail("loic@dupong.be"), "l***@dupong.be");
    assert.equal(maskEmail(undefined), "***@?");
});
