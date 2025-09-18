import argon2 from "argon2";
import { generateToken } from "../utils/jwt.utils.js";
import { v4 as uuidv4 } from "sequelize";

const users = [
    {
        id: uuidv4(),
        username: "admin",
        email: "admin@email.com",
        password: "$argon2id$v=19$m=65536,t=3,p=4$Z3Vlc3Q$X8m0u7+5r7T6Hc9vY1Y5cQ",
    }, // mot de passe = azerty
    {
        id: uuidv4(),
        username: "user1",
        email: "user1@email.com",
        password: "$argon2id$v=19$m=65536,t=3,p=4$Z3Vlc3Q$X8m0u7+5r7T6Hc9vY1Y5cQ",
    }, // mot de passe = azerty

];

const authController = {

    register: async (req, res) => {
        const { username, email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email or password missing !" });
        }

        const userExists = users.find(user => user.email === email);
        if (userExists) {
            return res.status(409).json({ error: "User already exists !" });
        }

        // Hashage du mot de passe
        const hash = await argon2.hash(password);
        console.log(hash);

        const newUser = {
            id: uuidv4(),
            username,
            email,
            password: hash
        };

        users.push(newUser);
        const token = await generateToken(newUser);

        res.status(201).json({ user: newUser, token });


    },

    login: async (req, res) => {
        const { email, password } = req.body;

        const user = users.find(user => user.email === email);

        if (!user) {
            res.status(401).json({ error: "User not found !" });
            return;
        }

        if (!await argon2.verify(user.password, password)) {
            res.status(401).json({ error: "Password invalid !" });
            return;
        }

        // Génération du token
        const token = await generateToken(user);

        res.status(200).json({ user, token });
    },

    logout: async (req, res) => {
        // Dans le cas d'une authentification par token JWT, pas de gestion de session côté serveur
        res.status(200).json({ message: "Logout successfull" });
    },

    me: async (req, res) => {
        if (!req.user) return res.status(401).json({ error: "Unauthorized" });

        res.status(200).json({
            user: { id: req.user.id, username: req.user.username, email: req.user.email },
        });
    },

    updatePassword: async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        const user = users.find(u => u.id === req.user.id);

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        if (!(await argon2.verify(user.password, oldPassword))) {
            return res.status(401).json({ error: "Old password invalid" });
        }

        user.password = await argon2.hash(newPassword);

        res.status(200).json({ message: "Password updated successfully" });
    },
};

export default authController;