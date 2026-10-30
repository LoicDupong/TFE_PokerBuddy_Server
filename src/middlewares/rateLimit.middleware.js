import { ipKeyGenerator, rateLimit } from "express-rate-limit";

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

// Réponses publiques (sans compte) aux invitations : 20 écritures par IP et par 15 min
export const guestAnswerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests, please try again in a few minutes" },
});

// Mot de passe oublié : 5 demandes par IP et par 15 min (un même compte reçoit en plus
// au plus un email toutes les 2 min, contrôlé dans le contrôleur sans le révéler)
export const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests, please try again in a few minutes" },
});

// Nouveau mot de passe via un lien : 10 essais ratés par IP et par 15 min
export const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts, please try again in a few minutes" },
});

// Actions qui redemandent le mot de passe d'un utilisateur connecté (changement, suppression du compte) :
// 5 échecs par compte et par 15 min, sinon une session volée permettrait de deviner le mot de passe.
// À placer après authorizeMiddleware() : la clé est l'id du compte (l'IP en secours).
export const passwordCheckLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts, please try again in 15 minutes" },
});

// Création de tickets de support : 5 par compte et par heure (anti-spam du back-office).
// À placer après authorizeMiddleware() : la clé est l'id du compte (l'IP en secours).
export const supportTicketLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many support requests, please try again later" },
});

// Messages dans un ticket : 30 par compte et par 15 min
export const supportMessageLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many messages, please try again in a few minutes" },
});

// Pings de mesure d'audience (public, sans cookie ni identifiant) : 120 par IP et par minute.
// L'IP ne sert qu'à la limite en mémoire, elle n'est jamais stockée.
export const analyticsLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests" },
});
