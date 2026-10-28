// ## Authentification Middleware

import { decodeToken } from "../utils/jwt.utils.js";
import db from "../models/index.js";

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
        let data;
        try {
            data = await decodeToken(token);
        } catch {
            // Token invalide
            req.user = null;
            next();
            return;
        }

        // Le compte est relu à chaque requête : un compte supprimé, désactivé, ou dont les sessions
        // ont été révoquées (tokenVersion incrémenté) ne passe plus, même avec un JWT non expiré.
        // Le rôle vient de la base, jamais du token.
        try {
            const user = await db.User.findByPk(data.id, {
                attributes: ["id", "username", "role", "tokenVersion", "disabledAt", "deletedAt"],
            });
            const valid = user && !user.deletedAt && !user.disabledAt && (data.tv ?? 0) === user.tokenVersion;
            req.user = valid ? { id: user.id, username: user.username, role: user.role } : null;
            next();
        } catch (error) {
            next(error);
        }
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

// Back-office : à placer sur chaque route /api/admin (aucune sécurité ne repose sur le front)
export function requireAdmin() {

    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        if (req.user.role !== "admin") {
            res.status(403).json({ error: "Forbidden" });
            return;
        }
        next();
    };
}
