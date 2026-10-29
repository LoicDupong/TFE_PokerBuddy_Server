import { test } from "node:test";
import assert from "node:assert/strict";
import passwordResetEmail from "../src/emails/password-reset.js";
import passwordChangedEmail from "../src/emails/password-changed.js";
import { escapeHtml } from "../src/emails/layout.js";

const RESET_URL = "https://pokerbuddy.example/auth/reset-password?token=AbC_-123";

for (const locale of ["en", "fr"]) {
    test(`password-reset (${locale}): subject, html and text are complete`, () => {
        const mail = passwordResetEmail({ username: "AceHigh", resetUrl: RESET_URL, expiresInMinutes: 30 }, locale);

        assert.deepEqual(Object.keys(mail).sort(), ["html", "subject", "text"]);
        for (const part of [mail.subject, mail.html, mail.text]) {
            assert.equal(typeof part, "string");
            assert.ok(part.length > 0);
            assert.doesNotMatch(part, /undefined|null|NaN|\[object Object\]/);
        }
        assert.match(mail.subject, /PokerBuddy/);
        assert.ok(mail.text.includes(RESET_URL), "text contains the link");
        assert.ok(mail.text.includes("AceHigh"));
        assert.ok(mail.text.includes("30"));
        assert.ok(mail.html.includes(`href="${RESET_URL}"`), "html links to the reset page");
        assert.match(mail.html, new RegExp(`<html lang="${locale}">`));
        assert.match(mail.html, /#d70022/i, "uses the brand red");
        assert.doesNotMatch(mail.html, /<img|<script|src=/i, "no external image or script");
    });
}

test("password-reset: unknown locale falls back to English", () => {
    const mail = passwordResetEmail({ username: "AceHigh", resetUrl: RESET_URL }, "de");
    assert.equal(mail.subject, "Reset your PokerBuddy password");
    assert.ok(mail.text.includes("30 minutes"), "default expiry is 30 minutes");
});

test("password-reset: parameters are HTML-escaped", () => {
    const mail = passwordResetEmail({ username: "<b>Evil</b>", resetUrl: `${RESET_URL}&x="><script>` });
    assert.doesNotMatch(mail.html, /<b>Evil<\/b>|"><script>/);
    assert.ok(mail.html.includes("&lt;b&gt;Evil&lt;/b&gt;"));
});

test("password-reset: missing parameters throw instead of printing undefined", () => {
    assert.throws(() => passwordResetEmail({ username: "AceHigh" }), /resetUrl/);
    assert.throws(() => passwordResetEmail({ resetUrl: RESET_URL }), /username/);
    assert.throws(() => passwordResetEmail(undefined), /username/);
});

test("password-changed: complete, links to forgot-password", () => {
    const url = "https://pokerbuddy.example/auth/forgot-password";
    for (const locale of ["en", "fr"]) {
        const mail = passwordChangedEmail({ username: "RiverQueen", forgotPasswordUrl: url }, locale);
        for (const part of [mail.subject, mail.html, mail.text]) {
            assert.doesNotMatch(part, /undefined|null|NaN/);
        }
        assert.ok(mail.html.includes(`href="${url}"`));
        assert.ok(mail.text.includes(url));
        assert.ok(mail.text.includes("RiverQueen"));
    }
    assert.throws(() => passwordChangedEmail({ username: "x" }), /forgotPasswordUrl/);
});

test("escapeHtml", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    assert.equal(escapeHtml(undefined), "");
});
