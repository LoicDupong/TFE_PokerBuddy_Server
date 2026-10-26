import { rateLimit } from "express-rate-limit";

// Anti brute-force : 10 échecs de connexion par IP sur 15 min (les connexions réussies ne comptent pas)
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many login attempts, please try again in 15 minutes" },
});

// Limite la création de comptes en masse : 10 inscriptions par IP et par heure
export const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many accounts created, please try again later" },
});
