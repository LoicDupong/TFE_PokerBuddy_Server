import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    RESET_REQUEST_COOLDOWN_MS,
    RESET_TOKEN_TTL_MS,
    buildResetUrl,
    generateResetToken,
    getAppUrl,
    hashResetToken,
    isResetRequestTooSoon,
    isResetTokenExpired,
    isResetTokenFormat,
    resetCooldownThreshold,
} from "../src/utils/passwordReset.utils.js";

test("generateResetToken: 32 random bytes in base64url, only the SHA-256 is meant for storage", () => {
    const now = Date.UTC(2026, 9, 28, 12, 0, 0);
    const { token, tokenHash, expiresAt } = generateResetToken(now);

    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, "base64url").length, 32);
    assert.equal(tokenHash, createHash("sha256").update(token).digest("hex"));
    assert.match(tokenHash, /^[0-9a-f]{64}$/);
    assert.notEqual(tokenHash, token);
    assert.equal(expiresAt.getTime(), now + 30 * 60 * 1000);
});

test("generateResetToken: two tokens are never the same", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateResetToken().token));
    assert.equal(tokens.size, 200);
});

test("hashResetToken is deterministic", () => {
    assert.equal(hashResetToken("abc"), hashResetToken("abc"));
    assert.notEqual(hashResetToken("abc"), hashResetToken("abd"));
});

test("isResetTokenFormat rejects anything but a 43-char base64url string", () => {
    assert.equal(isResetTokenFormat(generateResetToken().token), true);
    for (const bad of [undefined, null, 42, "", "short", "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`, { token: "x" }]) {
        assert.equal(isResetTokenFormat(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
});

test("isResetTokenExpired", () => {
    const now = Date.now();
    assert.equal(isResetTokenExpired(new Date(now + 1000), now), false);
    assert.equal(isResetTokenExpired(new Date(now), now), true);
    assert.equal(isResetTokenExpired(new Date(now - 1), now), true);
    assert.equal(isResetTokenExpired(null, now), true);
    assert.equal(isResetTokenExpired("not a date", now), true);
});

test("isResetRequestTooSoon: one email per account every 2 minutes", () => {
    const now = Date.now();
    const issuedAgo = (ms) => new Date(now - ms + RESET_TOKEN_TTL_MS); // expiration d'un jeton émis il y a ms

    assert.equal(isResetRequestTooSoon(null, now), false);
    assert.equal(isResetRequestTooSoon(issuedAgo(0), now), true);
    assert.equal(isResetRequestTooSoon(issuedAgo(RESET_REQUEST_COOLDOWN_MS - 1000), now), true);
    assert.equal(isResetRequestTooSoon(issuedAgo(RESET_REQUEST_COOLDOWN_MS), now), false);
    assert.equal(isResetRequestTooSoon(issuedAgo(RESET_TOKEN_TTL_MS + 1000), now), false); // déjà expiré
});

test("resetCooldownThreshold matches isResetRequestTooSoon (SQL condition)", () => {
    const now = Date.now();
    const threshold = resetCooldownThreshold(now);
    // Accepté par SQL ⇔ expiresAt <= threshold ⇔ pas "too soon"
    assert.equal(isResetRequestTooSoon(threshold, now), false);
    assert.equal(isResetRequestTooSoon(new Date(threshold.getTime() + 1), now), true);
});

test("buildResetUrl / getAppUrl", () => {
    assert.equal(buildResetUrl("https://app.example/", "abc_-"), "https://app.example/auth/reset-password?token=abc_-");
    assert.equal(getAppUrl({ APP_URL: "https://pokerbuddy.app//" }), "https://pokerbuddy.app");
    assert.equal(getAppUrl({ ALLOWED_ORIGIN: "https://front.example" }), "https://front.example");
    assert.equal(getAppUrl({}), "http://localhost:3000");
});
