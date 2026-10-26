import argon2 from "argon2";
import { generateToken } from "../utils/jwt.utils.js";
import db from "../models/index.js";
import {
    findUserByEmail,
    findUserByUsername,
    normalizeEmail,
    validateEmail,
    validatePassword,
    validateUsername,
} from "../utils/validation.utils.js";

// Hash factice vérifié quand l'email n'existe pas : même temps de réponse que pour un mauvais
// mot de passe, on ne peut pas deviner quels emails sont inscrits
const DUMMY_HASH = await argon2.hash("pokerbuddy-timing-equalizer");

const authController = {

    register: async (req, res) => {
        try {
            const { username, password } = req.body;
            const email = normalizeEmail(req.body.email);

            const validationError = validateUsername(username) || validateEmail(email) || validatePassword(password);
            if (validationError) {
                return res.status(400).json({ error: validationError });
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
                password: hash
            });

            const token = await generateToken(newUser);

            //* Ne jamais renvoyer le hash
            const { password: _, ...safeUser } = newUser.get({ plain: true });
            res.status(201).json({ user: safeUser, token });
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
            if (!user || !validPassword) {
                return res.status(401).json({ error: "Invalid email or password" });
            }

            // Génération du token
            const token = await generateToken(user);

            const { password: _, ...safeUser } = user.get({ plain: true });
            res.status(200).json({ user: safeUser, token });
        } catch (error) {
            console.error("Login error:", error);
            res.status(500).json({ error: "Error logging in" });
        }
    },

    me: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const user = await db.User.findByPk(req.user.id, {
                attributes: ["id", "username", "email", "avatar"],
            });

            if (!user) return res.status(404).json({ error: "User not found" });

            // Token renouvelé : la session glisse tant que l'utilisateur revient avant l'expiration
            const token = await generateToken(user);

            res.status(200).json({ user: user.get({ plain: true }), token });
        } catch (error) {
            console.error("Me error:", error);
            res.status(500).json({ error: "Error fetching session" });
        }
    },

    updatePassword: async (req, res) => {
        try {
            const { oldPassword, newPassword } = req.body;

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
            await user.update({ password: newHash });

            res.status(200).json({ message: "Password updated successfully" });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Error updating password" });
        }
    },
};

export default authController;
