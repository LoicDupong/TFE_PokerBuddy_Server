import { test } from "node:test";
import assert from "node:assert/strict";
import { isBot, normalizePath, ownHostsFromEnv, parseRange, referrerHostOf } from "../src/utils/analytics.utils.js";

test("normalizePath replaces ids and tokens, drops query string and hash", () => {
    assert.equal(normalizePath("/games/3f2b1c9e-1111-4222-8333-444455556666?x=1#top"), "/games/[id]");
    assert.equal(normalizePath("/games/3F2B1C9E-1111-4222-8333-444455556666/edit"), "/games/[id]/edit");
    assert.equal(normalizePath("/join/abcDEF123456"), "/join/[token]");
    assert.equal(normalizePath("/join/3f2b1c9e-1111-4222-8333-444455556666"), "/join/[token]");
    assert.equal(normalizePath("/profile/42"), "/profile/[id]");
    assert.equal(normalizePath("/learn/rules/"), "/learn/rules");
    assert.equal(normalizePath("/"), "/");
    assert.equal(normalizePath("https://pokerbuddy.app/leaderboard?a=b"), "/leaderboard");
});

test("normalizePath keeps only known pages", () => {
    assert.equal(normalizePath("/wp-admin/setup.php"), null);
    assert.equal(normalizePath("/learn/unknown"), null);
    assert.equal(normalizePath("/games/create/extra/deep/path/here/more"), null);
    assert.equal(normalizePath("games"), null);
    assert.equal(normalizePath(""), null);
    assert.equal(normalizePath(42), null);
    assert.equal(normalizePath("/" + "a".repeat(600)), null);
    assert.equal(normalizePath("/admin/support/3f2b1c9e-1111-4222-8333-444455556666"), "/admin/support/[id]");
    assert.equal(normalizePath("/admin/%00"), null);
});

test("referrerHostOf keeps the host only and ignores internal or invalid referrers", () => {
    assert.equal(referrerHostOf("https://www.Google.com/search?q=poker"), "www.google.com");
    assert.equal(referrerHostOf("", []), "");
    assert.equal(referrerHostOf("not a url"), "");
    assert.equal(referrerHostOf("javascript:alert(1)"), "");
    assert.equal(referrerHostOf("https://app.example.com/games", ["app.example.com"]), "");
    assert.deepEqual(ownHostsFromEnv({ APP_URL: "https://app.example.com/", ALLOWED_ORIGIN: "nope" }), ["app.example.com"]);
});

test("isBot filters robots, tools and missing user agents", () => {
    assert.equal(isBot(undefined), true);
    assert.equal(isBot("Googlebot/2.1 (+http://www.google.com/bot.html)"), true);
    assert.equal(isBot("curl/8.4.0"), true);
    assert.equal(isBot("Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0 Safari/537.36"), true);
    assert.equal(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"), false);
});

test("parseRange validates dates and bounds the period", () => {
    const now = new Date("2026-10-30T15:00:00Z");
    const def = parseRange({}, now);
    assert.equal(def.to, "2026-10-30");
    assert.equal(def.from, "2026-10-01");
    assert.equal(def.days, 30);

    const custom = parseRange({ from: "2026-01-01", to: "2026-01-31" }, now);
    assert.equal(custom.days, 31);
    assert.equal(custom.toExclusive.toISOString(), "2026-02-01T00:00:00.000Z");

    assert.match(parseRange({ from: "garbage" }, now).error, /Invalid 'from'/);
    assert.match(parseRange({ to: "2026-02-31" }, now).error, /Invalid 'to'/);
    assert.match(parseRange({ from: "2026-02-01", to: "2026-01-01" }, now).error, /must not be after/);
    assert.match(parseRange({ from: "2020-01-01", to: "2026-01-01" }, now).error, /at most 366/);
});
