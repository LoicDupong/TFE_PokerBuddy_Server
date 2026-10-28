import { test } from "node:test";
import assert from "node:assert/strict";
import { toSafeUser } from "../src/utils/user.utils.js";

test("toSafeUser never exposes secrets", () => {
    const safe = toSafeUser({
        id: "u1",
        username: "AceHigh",
        email: "ace@example.com",
        password: "$argon2id$hash",
        tokenVersion: 3,
        passwordResetTokenHash: "abc",
        passwordResetExpiresAt: new Date(),
        role: "user",
    });
    assert.deepEqual(safe, { id: "u1", username: "AceHigh", email: "ace@example.com", role: "user" });
});

test("toSafeUser accepts a Sequelize instance", () => {
    const instance = { get: () => ({ id: "u2", username: "RiverQueen", password: "x" }) };
    assert.deepEqual(toSafeUser(instance), { id: "u2", username: "RiverQueen" });
});
