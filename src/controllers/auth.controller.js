import argon2 from "argon2";
import { Op } from "sequelize";
import { generateToken, verifyGuestToken } from "../utils/jwt.utils.js";
import db from "../models/index.js";
import {
    findUserByEmail,
    findUserByUsername,
    normalizeEmail,
    validateEmail,
    validatePassword,
    validateUsername,
} from "../utils/validation.utils.js";
import { isSupportedLocale, localeOf, toSafeUser } from "../utils/user.utils.js";
import { isReservedEmail } from "../utils/account.utils.js";
import { sendMail } from "../utils/mail.utils.js";
import {
    RESET_TOKEN_TTL_MS,
    buildResetUrl,
    generateResetToken,
    getAppUrl,
    hashResetToken,
    isResetTokenExpired,
    isResetTokenFormat,
    resetCooldownThreshold,
} from "../utils/passwordReset.utils.js";
import passwordResetEmail from "../emails/password-reset.js";
import passwordChangedEmail from "../emails/password-changed.js";

// Hash factice vérifié quand l'email n'existe pas : même temps de réponse que pour un mauvais
// mot de passe, on ne peut pas deviner quels emails sont inscrits
const DUMMY_HASH = await argon2.hash("pokerbuddy-timing-equalizer");

// Même réponse que le compte existe ou non
const FORGOT_PASSWORD_MESSAGE = "If an account exists for this email, a link to reset the password has been sent";
const INVALID_RESET_LINK = { error: "Invalid or expired link", code: "INVALID_RESET_TOKEN" };

// tokenVersion + 1 en SQL : toutes les sessions (JWT) déjà émises deviennent invalides
const bumpTokenVersion = () => db.sequelize.literal('"tokenVersion" + 1');

// Traitement d'une demande de mot de passe oublié, lancé APRÈS la réponse HTTP :
// le temps de réponse ne dépend ni de l'existence du compte ni de l'envoi de l'email.
// Ne lève jamais : toute erreur est seulement loguée (sans l'adresse ni le jeton).
async function processPasswordResetRequest(email) {
    try {
        const user = await findUserByEmail(email);
        // Compte inconnu, supprimé ou désactivé : aucun email
        if (!user || user.deletedAt || user.disabledAt) return;

        const now = Date.now();
        const { token, tokenHash, expiresAt } = generateResetToken(now);

        // Mise à jour conditionnelle (atomique) : une nouvelle demande remplace l'ancienne,
        // sauf si le jeton en cours a moins de 2 min (anti-spam, même depuis plusieurs IP)
        const [updated] = await db.User.update(
            { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt },
            {
                where: {
                    id: user.id,
                    [Op.or]: [
                        { passwordResetExpiresAt: null },
                        { passwordResetExpiresAt: { [Op.lte]: resetCooldownThreshold(now) } },
                    ],
                },
            }
        );
        if (!updated) {
            console.log(`Password reset: request for user ${user.id} ignored (cooldown)`);
            return;
        }

        const mail = passwordResetEmail({
            username: user.username,
            resetUrl: buildResetUrl(getAppUrl(), token),
            expiresInMinutes: RESET_TOKEN_TTL_MS / 60000,
        }, localeOf(user));
        await sendMail({ to: user.email, ...mail });
    } catch (error) {
        console.error("Password reset email failed:", error);
    }
}

// Alerte "ton mot de passe a changé" : non bloquante, n'échoue jamais la requête
function notifyPasswordChanged(user) {
    const mail = passwordChangedEmail({
        username: user.username,
        forgotPasswordUrl: `${getAppUrl()}/auth/forgot-password`,
    }, localeOf(user));
    sendMail({ to: user.email, ...mail }).catch((error) => console.error("Password changed email failed:", error));
}

const authController = {

    register: async (req, res) => {
        try {
            const { username, password } = req.body;
            const email = normalizeEmail(req.body.email);

            const validationError = validateUsername(username) || validateEmail(email) || validatePassword(password);
            if (validationError) {
                return res.status(400).json({ error: validationError });
            }

            // Domaine réservé aux comptes supprimés : personne ne doit pouvoir occuper à l'avance
            // l'adresse d'anonymisation d'un autre (ce qui bloquerait la suppression de son compte)
            if (isReservedEmail(email)) {
                return res.status(400).json({ error: "Invalid email address" });
            }

            if (await findUserByEmail(email)) {
                return res.status(409).json({ error: "Email already in use" });
            }

            if (await findUserByUsername(username)) {
                return res.status(409).json({ error: "Username already taken" });
            }

            // Hashage du mot de passe
            const hash = await argon2.hash(password);

            // Création de l'utilisateur
            const newUser = await db.User.create({
                username,
                email,
                password: hash,
                // Langue de l'interface à l'inscription (facultatif)
                ...(isSupportedLocale(req.body.locale) ? { locale: req.body.locale } : {}),
            });

            // Rattache la réponse d'invité (lien "claim") au nouveau compte ; un claim invalide ne bloque jamais l'inscription
            try {
                const claim = verifyGuestToken(req.body.claim);
                if (claim) {
                    const row = await db.GamePlayer.findByPk(claim.gamePlayerId);
                    if (row && row.gameId === claim.gameId && row.userId === null) {
                        const already = await db.GamePlayer.findOne({ where: { gameId: row.gameId, userId: newUser.id } });
                        if (!already) await row.update({ userId: newUser.id, userName: newUser.username });
                    }
                }
            } catch (claimError) {
                console.error("Claim guest error:", claimError);
            }

            const token = await generateToken(newUser);

            //* Ne jamais renvoyer le hash
            res.status(201).json({ user: toSafeUser(newUser), token });
        } catch (error) {
            // Deux inscriptions simultanées avec le même email/pseudo
            if (error.name === "SequelizeUniqueConstraintError") {
                return res.status(409).json({ error: "Email or username already in use" });
            }
            console.error("Register error:", error);
            res.status(500).json({ error: "Error creating account" });
        }
    },

    login: async (req, res) => {
        try {
            const email = normalizeEmail(req.body.email);
            const password = typeof req.body.password === "string" ? req.body.password : "";

            const user = email ? await findUserByEmail(email) : null;
            const validPassword = await argon2.verify(user?.password ?? DUMMY_HASH, password);

            // Même message dans les deux cas : ne pas révéler si l'email existe
            // Compte supprimé : même réponse qu'un email inconnu
            if (!user || !validPassword || user.deletedAt) {
                return res.status(401).json({ error: "Invalid email or password" });
            }

            // Mot de passe correct mais compte désactivé par un administrateur
            if (user.disabledAt) {
                return res.status(403).json({ error: "This account has been disabled" });
            }

            // Génération du token
            const token = await generateToken(user);

            res.status(200).json({ user: toSafeUser(user), token });
        } catch (error) {
            console.error("Login error:", error);
            res.status(500).json({ error: "Error logging in" });
        }
    },

    me: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const user = await db.User.findByPk(req.user.id, {
                // tokenVersion : nécessaire pour renouveler le token, jamais renvoyé
                attributes: ["id", "username", "email", "avatar", "role", "locale", "tokenVersion"],
            });

            if (!user) return res.status(404).json({ error: "User not found" });

            // Token renouvelé : la session glisse tant que l'utilisateur revient avant l'expiration
            const token = await generateToken(user);

            res.status(200).json({ user: toSafeUser(user), token });
        } catch (error) {
            console.error("Me error:", error);
            res.status(500).json({ error: "Error fetching session" });
        }
    },

    updatePassword: async (req, res) => {
        try {
            const { oldPassword, newPassword } = req.body ?? {};

            const passwordError = validatePassword(newPassword);
            if (passwordError) {
                return res.status(400).json({ error: passwordError });
            }

            const user = await db.User.findByPk(req.user.id);
            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const validPassword = await argon2.verify(user.password, typeof oldPassword === "string" ? oldPassword : "");
            // 400 et pas 401 : le client déconnecte l'utilisateur sur tout 401
            if (!validPassword) {
                return res.status(400).json({ error: "Old password invalid" });
            }

            const newHash = await argon2.hash(newPassword);
            // tokenVersion + 1 : les autres appareils sont déconnectés ; un lien de reset en cours ne sert plus
            await user.update({
                password: newHash,
                tokenVersion: bumpTokenVersion(),
                passwordResetTokenHash: null,
                passwordResetExpiresAt: null,
            });
            await user.reload();

            // Nouveau token pour la session courante, qui reste ouverte
            const token = await generateToken(user);

            notifyPasswordChanged(user);

            res.status(200).json({ message: "Password updated successfully", token });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Error updating password" });
        }
    },

    // POST /api/auth/forgot-password { email } → toujours 200, même message, réponse immédiate
    forgotPassword: (req, res) => {
        const email = normalizeEmail(req.body?.email);

        res.status(200).json({ message: FORGOT_PASSWORD_MESSAGE });

        // Adresse mal formée : rien à chercher (le client la valide déjà)
        if (!validateEmail(email)) void processPasswordResetRequest(email);
    },

    // POST /api/auth/reset-password { token, password } → 200, ou 400 "Invalid or expired link"
    resetPassword: async (req, res) => {
        try {
            const { token, password } = req.body ?? {};

            if (!isResetTokenFormat(token)) return res.status(400).json(INVALID_RESET_LINK);

            const tokenHash = hashResetToken(token);
            const user = await db.User.findOne({
                where: { passwordResetTokenHash: tokenHash },
                attributes: ["id", "username", "email", "locale", "passwordResetExpiresAt", "deletedAt", "disabledAt"],
            });
            if (!user || isResetTokenExpired(user.passwordResetExpiresAt) || user.deletedAt || user.disabledAt) {
                return res.status(400).json(INVALID_RESET_LINK);
            }

            // Mêmes règles qu'à l'inscription
            const passwordError = validatePassword(password);
            if (passwordError) return res.status(400).json({ error: passwordError });

            const hash = await argon2.hash(password);

            // Le jeton n'est consommé qu'une fois, même si deux requêtes arrivent en même temps :
            // la mise à jour ne passe que s'il est toujours là et valide
            const [updated] = await db.User.update(
                {
                    password: hash,
                    tokenVersion: bumpTokenVersion(),
                    passwordResetTokenHash: null,
                    passwordResetExpiresAt: null,
                },
                {
                    where: {
                        id: user.id,
                        passwordResetTokenHash: tokenHash,
                        passwordResetExpiresAt: { [Op.gt]: new Date() },
                        deletedAt: null,
                        disabledAt: null,
                    },
                }
            );
            if (!updated) return res.status(400).json(INVALID_RESET_LINK);

            notifyPasswordChanged(user);

            // L'email sert à pré-remplir le login : le porteur du lien y a déjà accès
            res.status(200).json({ message: "Password updated, you can now log in", email: user.email });
        } catch (error) {
            console.error("Reset password error:", error);
            res.status(500).json({ error: "Error resetting password" });
        }
    },
};

export default authController;
