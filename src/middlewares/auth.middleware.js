// ## Authentification Middleware

import { decodeToken } from "../utils/jwt.utils.js";

export function authMiddleware() {
    return async (req, res, next) => {
        // Récupération du token dans le header Authorization
        const authData = req.headers['authorization'] ?? '';

        // Extraction du token
        const [prefix, token] = authData.split(' ');

        if (prefix?.toLowerCase() !== 'bearer' || !token) {
            req.user = null;
            next();
            return;
        }

        // Récupuration des données contenu dans le token
        try {
            // User identifié
            req.user = await decodeToken(token);
        } catch {
            // Token invalide
            req.user = null;
        }
        next();
    };
}

export function authorizeMiddleware() {

    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        next();
    };
}
