// Analytics sans cookie : normalisation des pages vues et période des rapports.
// Fonctions pures, testées dans test/analytics.utils.test.js.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Routes connues de l'app (App Router) une fois les identifiants remplacés ; tout le reste est ignoré
// (scans de bots, URL inventées) pour que la table ne grossisse pas avec n'importe quelle valeur.
const KNOWN_PATHS = new Set([
    "/",
    "/auth/forgot-password", "/auth/login", "/auth/register", "/auth/reset-password",
    "/games", "/games/create", "/games/history", "/games/[id]", "/games/[id]/edit",
    "/join/[token]",
    "/leaderboard",
    "/learn", "/learn/hands", "/learn/rules", "/learn/strategy", "/learn/terms",
    "/manager", "/manager/preset",
    "/notifications",
    "/profile", "/profile/edit", "/profile/[id]",
    "/help", "/help/tickets", "/help/tickets/[id]",
]);
// Le back-office (agent I) : tout sous /admin, segments simples uniquement
const ADMIN_PATH_RE = /^\/admin(\/[a-z-]+|\/\[id\]){0,3}$/;

const PATH_MAX = 200;
const HOST_MAX = 100;

/**
 * "/games/3f2b…/edit?x=1#top" → "/games/[id]/edit" ; "/join/<jeton>" → "/join/[token]".
 * Renvoie null si la page n'est pas une page connue de l'app.
 */
export function normalizePath(raw) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return null;
    // Une URL complète est réduite à son chemin ; query string et ancre sont supprimées
    let pathname = raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
    pathname = pathname.split(/[?#]/)[0];
    if (!pathname.startsWith("/")) return null;

    const segments = pathname.split("/").filter(Boolean).map((segment) => {
        let decoded = segment;
        try { decoded = decodeURIComponent(segment); } catch { /* garde la valeur brute */ }
        return decoded.toLowerCase();
    });
    if (segments.length > 5) return null;

    const normalized = segments.map((segment, index) => {
        if (segments[0] === "join" && index === 1) return "[token]";
        if (UUID_RE.test(segment) || /^\d+$/.test(segment)) return "[id]";
        return segment;
    });
    const result = normalized.length ? `/${normalized.join("/")}` : "/";
    if (result.length > PATH_MAX) return null;
    return KNOWN_PATHS.has(result) || ADMIN_PATH_RE.test(result) ? result : null;
}

/**
 * Site référent réduit à son nom d'hôte ("https://www.google.com/search?q=x" → "www.google.com").
 * Vide si absent, invalide, non http(s) ou si c'est l'app elle-même (navigation interne).
 */
export function referrerHostOf(referrer, ownHosts = []) {
    if (typeof referrer !== "string" || !referrer || referrer.length > 2000) return "";
    let url;
    try { url = new URL(referrer); } catch { return ""; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    if (!host || host.length > HOST_MAX) return "";
    return ownHosts.includes(host) ? "" : host;
}

// Hôtes de l'app elle-même (APP_URL, ALLOWED_ORIGIN) pour ignorer la navigation interne
export function ownHostsFromEnv(env = process.env) {
    return [env.APP_URL, env.ALLOWED_ORIGIN]
        .map((value) => { try { return value ? new URL(value).hostname.toLowerCase() : null; } catch { return null; } })
        .filter(Boolean);
}

const BOT_RE = /bot|crawl|spider|slurp|headless|preview|lighthouse|pingdom|uptime|monitor|facebookexternalhit|curl|wget|python|java\/|go-http|node-fetch|axios|okhttp|libwww|httpclient/i;

// Pas de User-Agent ou User-Agent connu de robots/outils : la visite n'est pas comptée
export const isBot = (userAgent) => typeof userAgent !== "string" || userAgent.length < 10 || BOT_RE.test(userAgent);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 30;

export const isoDay = (date) => date.toISOString().slice(0, 10);

function parseDay(value) {
    if (!DAY_RE.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || isoDay(date) !== value ? null : date;
}

/**
 * Période d'un rapport : jours UTC inclusifs, `to` par défaut = aujourd'hui, `from` = 30 jours avant.
 * Renvoie { from, to, fromDate, toExclusive, days } ou { error }.
 */
export function parseRange({ from, to } = {}, now = new Date()) {
    const toDate = to ? parseDay(to) : parseDay(isoDay(now));
    if (!toDate) return { error: "Invalid 'to' date (expected YYYY-MM-DD)" };
    const fromDate = from ? parseDay(from) : new Date(toDate.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
    if (!fromDate) return { error: "Invalid 'from' date (expected YYYY-MM-DD)" };
    if (fromDate > toDate) return { error: "'from' must not be after 'to'" };
    const days = Math.round((toDate - fromDate) / DAY_MS) + 1;
    if (days > MAX_RANGE_DAYS) return { error: `Range must be at most ${MAX_RANGE_DAYS} days` };
    return { from: isoDay(fromDate), to: isoDay(toDate), fromDate, toExclusive: new Date(toDate.getTime() + DAY_MS), days };
}
