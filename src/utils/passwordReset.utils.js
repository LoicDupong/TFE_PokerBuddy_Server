import { createHash, randomBytes } from "node:crypto";

// Logique pure du mot de passe oublié (aucun accès à la base) : testée par node --test.

// Durée de validité d'un lien de réinitialisation
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
// Anti-spam par compte : pas plus d'un email toutes les 2 minutes, quelle que soit l'IP
export const RESET_REQUEST_COOLDOWN_MS = 2 * 60 * 1000;

// 32 octets en base64url = 43 caractères [A-Za-z0-9_-], sans padding
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

// Seul le SHA-256 est stocké : une fuite de la base ne donne aucun lien utilisable.
// Pas besoin de sel ni d'argon2 ici : le jeton est aléatoire (256 bits), pas devinable.
export function hashResetToken(token) {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateResetToken(now = Date.now()) {
    const token = randomBytes(32).toString("base64url");
    return {
        token,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(now + RESET_TOKEN_TTL_MS),
    };
}

// Filtre les valeurs absurdes avant toute requête en base
export function isResetTokenFormat(token) {
    return typeof token === "string" && TOKEN_FORMAT.test(token);
}

export function isResetTokenExpired(expiresAt, now = Date.now()) {
    if (!expiresAt) return true;
    const time = new Date(expiresAt).getTime();
    return Number.isNaN(time) || time <= now;
}

// Le jeton en cours a été émis il y a moins de RESET_REQUEST_COOLDOWN_MS (émission = expiration - TTL) :
// on ne le remplace pas et on n'envoie pas d'email. Évite d'inonder une boîte mail depuis plusieurs IP.
export function isResetRequestTooSoon(expiresAt, now = Date.now()) {
    if (!expiresAt) return false;
    const issuedAt = new Date(expiresAt).getTime() - RESET_TOKEN_TTL_MS;
    return now - issuedAt < RESET_REQUEST_COOLDOWN_MS;
}

// Même règle exprimée pour la requête SQL : une nouvelle demande n'est acceptée que si
// l'expiration enregistrée est nulle ou antérieure (ou égale) à ce seuil
export function resetCooldownThreshold(now = Date.now()) {
    return new Date(now + RESET_TOKEN_TTL_MS - RESET_REQUEST_COOLDOWN_MS);
}

// URL du client (pas de l'API) : c'est la page Next.js qui affiche le formulaire
export function getAppUrl(env = process.env) {
    const url = env.APP_URL || env.ALLOWED_ORIGIN || "http://localhost:3000";
    return url.replace(/\/+$/, "");
}

export function buildResetUrl(appUrl, token) {
    return `${appUrl.replace(/\/+$/, "")}/auth/reset-password?token=${encodeURIComponent(token)}`;
}
