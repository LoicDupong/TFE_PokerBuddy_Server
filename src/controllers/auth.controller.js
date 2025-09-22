import argon2 from "argon2";
import { generateToken } from "../utils/jwt.utils.js";
import db from "../models/index.js";


const authController = {

    register: async (req, res) => {
        const { username, email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email or password missing !" });
        }

        const userExists = await db.User.findOne({ where: { email : email } });
        
        
        if (userExists) {
            return res.status(409).json({ error: "User already exists !" });
        }

        // Hashage du mot de passe
        const hash = await argon2.hash(password);
        console.log(hash);

        // Création de l'utilisateur
        const newUser = await db.User.create({
            username,
            email,
            password: hash
        });

        const token = await generateToken(newUser);

        //* Ne pas renvoyer le hash en prod
        const { password: _, ...safeUser } = newUser.get({ plain: true });
        res.status(201).json({
            user: process.env.NODE_ENV === "dev" ? newUser : safeUser,
            token
        });



    },

    login: async (req, res) => {
        const { email, password } = req.body;

        const user = await db.User.findOne({ where: { email : email } });

        if (!user) {
            res.status(401).json({ error: "User not found !" });
            return;
        }

        if (!await argon2.verify(user.password, password)) {
            res.status(401).json({ error: "Password invalid !" });
            return;
        }

        // Génération du token
        const loginToken = await generateToken(user);

        res.status(200).json({ user, token: loginToken });
    },

    me: async (req, res) => {
        if (!req.user) return res.status(401).json({ error: "Unauthorized" });

        res.status(200).json({
            user: { id: req.user.id, username: req.user.username, email: req.user.email },
        });
    },

    updatePassword: async (req, res) => {
        try {
            const { oldPassword, newPassword } = req.body;

            const user = await db.User.findByPk(req.user.id);
            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const validPassword = await argon2.verify(user.password, oldPassword);
            if (!validPassword) {
                return res.status(401).json({ error: "Old password invalid" });
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