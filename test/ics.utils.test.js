import { test } from "node:test";
import assert from "node:assert/strict";
import {
    GAME_DURATION_MS,
    buildGameIcs,
    escapeIcsText,
    foldIcsLine,
    formatIcsDate,
    gameIcsUid,
    icsFilename,
    joinInviteUrl,
} from "../src/utils/ics.utils.js";

const NOW = new Date("2026-10-28T20:00:00.000Z");
const START = "2026-11-06T19:00:00.000Z"; // vendredi 6 nov., 20:00 à Bruxelles (CET)

// Déplie les lignes (RFC 5545 §3.1) : CRLF suivi d'une espace ou d'une tabulation
const unfold = (ics) => ics.replace(/\r\n[ \t]/g, "");
const property = (ics, name) => unfold(ics).split("\r\n").find((line) => line.startsWith(`${name}:`));

test("formatIcsDate writes UTC with a trailing Z", () => {
    assert.equal(formatIcsDate(new Date("2026-11-06T19:00:00.000Z")), "20261106T190000Z");
    // Une date avec décalage est convertie en UTC (heure exacte préservée)
    assert.equal(formatIcsDate("2027-06-04T20:30:00+02:00"), "20270604T183000Z");
    assert.throws(() => formatIcsDate("not a date"), RangeError);
});

test("escapeIcsText escapes backslashes, separators and newlines", () => {
    assert.equal(escapeIcsText("a\\b"), "a\\\\b");
    assert.equal(escapeIcsText("Hold'em, Round 2; Aces"), "Hold'em\\, Round 2\\; Aces");
    assert.equal(escapeIcsText("line 1\nline 2\r\nline 3\rline 4"), "line 1\\nline 2\\nline 3\\nline 4");
    // Les deux-points et guillemets n'ont pas besoin d'échappement dans une valeur TEXT
    assert.equal(escapeIcsText('Doors: 19:45 "sharp"'), 'Doors: 19:45 "sharp"');
    // Caractères de contrôle interdits par la RFC (sauf tabulation) : retirés
    assert.equal(escapeIcsText("a\u0000b\u0007c\td"), "abc\td");
    assert.equal(escapeIcsText(null), "");
    assert.equal(escapeIcsText(undefined), "");
});

test("foldIcsLine keeps short lines intact", () => {
    const line = "SUMMARY:" + "x".repeat(67); // 75 octets pile
    assert.equal(foldIcsLine(line), line);
});

test("foldIcsLine folds at 75 octets with a leading space", () => {
    const line = "DESCRIPTION:" + "a".repeat(200);
    const folded = foldIcsLine(line);
    const parts = folded.split("\r\n");
    assert.ok(parts.length > 1);
    parts.forEach((part, i) => {
        assert.ok(Buffer.byteLength(part, "utf8") <= 75, `line ${i} is ${Buffer.byteLength(part)} octets`);
        if (i > 0) assert.equal(part[0], " ");
    });
    assert.equal(Buffer.byteLength(parts[0], "utf8"), 75);
    assert.equal(unfold(folded), line);
});

test("foldIcsLine never splits a multi-byte character", () => {
    // é = 2 octets, 🂡 = 4 octets (paire de substitution en JS)
    const line = "SUMMARY:" + "é🂡".repeat(40);
    const folded = foldIcsLine(line);
    for (const part of folded.split("\r\n")) {
        assert.ok(Buffer.byteLength(part, "utf8") <= 75);
        assert.ok(!part.includes("�"));
        // Une moitié de paire de substitution isolée se verrait ici
        assert.equal(Buffer.from(part, "utf8").toString("utf8"), part);
        assert.doesNotMatch(part, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    assert.equal(unfold(folded), line);
});

test("buildGameIcs produces a valid VCALENDAR with CRLF everywhere", () => {
    const ics = buildGameIcs({
        uid: gameIcsUid("7d79cd78-705f-4b7a-99fc-9c7290e64ab4"),
        start: START,
        summary: "Friday Night Poker",
        location: "Home",
        description: "Weekly home game",
        now: NOW,
    });
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PokerBuddy//EN\r\nBEGIN:VEVENT\r\n"));
    assert.ok(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
    // Aucun LF isolé : toutes les fins de ligne sont des CRLF
    assert.equal(ics.replace(/\r\n/g, "").includes("\n"), false);
    assert.equal(ics.replace(/\r\n/g, "").includes("\r"), false);

    assert.equal(property(ics, "UID"), "UID:7d79cd78-705f-4b7a-99fc-9c7290e64ab4@pokerbuddy");
    assert.equal(property(ics, "DTSTAMP"), "DTSTAMP:20261028T200000Z");
    assert.equal(property(ics, "DTSTART"), "DTSTART:20261106T190000Z");
    assert.equal(property(ics, "DTEND"), "DTEND:20261106T220000Z");
    assert.equal(property(ics, "SUMMARY"), "SUMMARY:Friday Night Poker");
    assert.equal(property(ics, "LOCATION"), "LOCATION:Home");
    assert.equal(property(ics, "DESCRIPTION"), "DESCRIPTION:Weekly home game");
    assert.equal(property(ics, "URL"), undefined);
});

test("buildGameIcs keeps the 3-hour default duration and accepts another one", () => {
    assert.equal(GAME_DURATION_MS, 3 * 60 * 60 * 1000);
    const ics = buildGameIcs({ uid: "x@pokerbuddy", start: START, summary: "Short", durationMs: 90 * 60 * 1000, now: NOW });
    assert.equal(property(ics, "DTEND"), "DTEND:20261106T203000Z");
});

test("buildGameIcs omits missing or blank optional fields", () => {
    const ics = buildGameIcs({ uid: "x@pokerbuddy", start: START, summary: "No extras", location: "   ", description: null, now: NOW });
    assert.equal(property(ics, "LOCATION"), undefined);
    assert.equal(property(ics, "DESCRIPTION"), undefined);
    assert.equal(property(ics, "URL"), undefined);
    assert.equal(unfold(ics).split("\r\n").filter(Boolean).length, 11);
});

test("buildGameIcs escapes and folds long text properties", () => {
    const ics = buildGameIcs({
        uid: "x@pokerbuddy",
        start: START,
        summary: "Late Night Hold'em, Round 2; Aces & Kings — Édition spéciale du vendredi soir",
        location: "Rue de la Loi 16, 1000 Bruxelles; ring twice",
        description: "Bring snacks, chips provided.\nDoors open at 19:45",
        now: NOW,
    });
    for (const line of ics.split("\r\n")) {
        assert.ok(Buffer.byteLength(line, "utf8") <= 75, `"${line}" is too long`);
    }
    assert.equal(property(ics, "SUMMARY"), "SUMMARY:Late Night Hold'em\\, Round 2\\; Aces & Kings — Édition spéciale du vendredi soir");
    assert.equal(property(ics, "LOCATION"), "LOCATION:Rue de la Loi 16\\, 1000 Bruxelles\\; ring twice");
    assert.equal(property(ics, "DESCRIPTION"), "DESCRIPTION:Bring snacks\\, chips provided.\\nDoors open at 19:45");
});

test("buildGameIcs adds a URL property only for a valid http(s) URL", () => {
    const url = "https://pokerbuddy.example/join/2f0c3a52-35b1-4bb9-9f0e-6f3bd1e2a0b1";
    const ics = buildGameIcs({ uid: "x@pokerbuddy", start: START, summary: "With link", url, now: NOW });
    assert.equal(property(ics, "URL"), `URL:${url}`);

    const injected = buildGameIcs({ uid: "x@pokerbuddy", start: START, summary: "Bad", url: "javascript:alert(1)", now: NOW });
    assert.equal(property(injected, "URL"), undefined);
    const broken = buildGameIcs({ uid: "x@pokerbuddy", start: START, summary: "Bad", url: "not a url\r\nX-EVIL:1", now: NOW });
    assert.equal(property(broken, "URL"), undefined);
    assert.equal(property(broken, "X-EVIL"), undefined);
});

test("joinInviteUrl builds the invite link only when APP_URL is known", () => {
    const token = "2f0c3a52-35b1-4bb9-9f0e-6f3bd1e2a0b1";
    assert.equal(joinInviteUrl(token, "https://pokerbuddy.example"), `https://pokerbuddy.example/join/${token}`);
    assert.equal(joinInviteUrl(token, "https://pokerbuddy.example/"), `https://pokerbuddy.example/join/${token}`);
    assert.equal(joinInviteUrl(token, ""), null);
    assert.equal(joinInviteUrl(token, undefined), null);
    assert.equal(joinInviteUrl(token, "not a url"), null);
});

test("icsFilename gives a safe ASCII file name", () => {
    assert.equal(icsFilename("Late Night Hold'em, Round 2 — Édition spéciale"), "late-night-hold-em-round-2-edition-speciale.ics");
    assert.equal(icsFilename("🃏🃏"), "poker-game.ics");
    assert.equal(icsFilename(""), "poker-game.ics");
    assert.ok(icsFilename("x".repeat(200)).length <= 64);
});
