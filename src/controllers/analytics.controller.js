import express from "express";
import db from "../models/index.js";
import { isBot, normalizePath, ownHostsFromEnv, referrerHostOf } from "../utils/analytics.utils.js";

// sendBeacon envoie du text/plain (requête CORS "simple", sans preflight) : le JSON est lu à la main
export const parseBeaconBody = express.text({ type: "text/plain", limit: "2kb" });

function readBody(req) {
    if (typeof req.body === "string") {
        try { return JSON.parse(req.body); } catch { return null; }
    }
    return req.body && typeof req.body === "object" ? req.body : null;
}

const analyticsController = {
    // Public. Répond 204 même quand la visite est ignorée (bot, page inconnue) : le client n'a rien à savoir.
    // Rien d'identifiant n'est lu ni stocké : ni IP, ni cookie, ni en-tête autre que le User-Agent (filtre de robots).
    pageview: async (req, res) => {
        try {
            const body = readBody(req);
            if (!body || typeof body.path !== "string") return res.status(400).json({ error: "Invalid body" });
            if (body.referrer !== undefined && body.referrer !== null && typeof body.referrer !== "string") {
                return res.status(400).json({ error: "Invalid body" });
            }

            if (isBot(req.get("user-agent"))) return res.status(204).end();
            const path = normalizePath(body.path);
            if (!path) return res.status(204).end();
            const referrerHost = referrerHostOf(body.referrer, ownHostsFromEnv());

            await db.sequelize.query(
                `INSERT INTO page_views_daily ("day", "path", "referrerHost", "views")
                 VALUES ((now() AT TIME ZONE 'UTC')::date, :path, :referrerHost, 1)
                 ON CONFLICT ("day", "path", "referrerHost") DO UPDATE SET "views" = page_views_daily."views" + 1`,
                { replacements: { path, referrerHost } }
            );
            return res.status(204).end();
        } catch (error) {
            console.error("pageview error:", error);
            return res.status(500).json({ error: "Error recording page view" });
        }
    },
};

export default analyticsController;
