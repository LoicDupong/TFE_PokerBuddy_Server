import { test } from "node:test";
import assert from "node:assert/strict";
import { isSupportedLocale, localeOf, toSafeUser } from "../src/utils/user.utils.js";
import passwordResetEmail from "../src/emails/password-reset.js";
import passwordChangedEmail from "../src/emails/password-changed.js";

test("isSupportedLocale only accepts en and fr", () => {
    assert.equal(isSupportedLocale("en"), true);
    assert.equal(isSupportedLocale("fr"), true);
    for (const bad of ["de", "EN", "", null, undefined, 1, "fr-BE"]) assert.equal(isSupportedLocale(bad), false);
});

test("localeOf falls back to en", () => {
    assert.equal(localeOf({ locale: "fr" }), "fr");
    assert.equal(localeOf({ locale: "xx" }), "en");
    assert.equal(localeOf(null), "en");
});

test("toSafeUser exposes locale", () => {
    assert.equal(toSafeUser({ id: "u1", username: "A", locale: "fr", password: "x" }).locale, "fr");
});

test("emails follow the recipient locale", () => {
    const user = { username: "AceHigh", locale: "fr" };
    const reset = passwordResetEmail({ username: user.username, resetUrl: "https://x.example/r?t=1" }, localeOf(user));
    assert.match(reset.subject, /Réinitialise/);
    assert.match(reset.html, /<html lang="fr">/);
    const changed = passwordChangedEmail({ username: "AceHigh", forgotPasswordUrl: "https://x.example/f" }, localeOf({ locale: "en" }));
    assert.match(changed.subject, /was changed/);
    assert.match(changed.html, /<html lang="en">/);
});
