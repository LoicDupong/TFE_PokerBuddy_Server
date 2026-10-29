import { Op } from "sequelize";
import argon2 from "argon2";
import { randomUUID } from "crypto";
import db from "../models/index.js"; // Sequelize models
import { generateToken } from "../utils/jwt.utils.js";
import { findUserByUsername, validateUsername } from "../utils/validation.utils.js";
import { removeAvatar, storeAvatar } from "../middlewares/upload.middleware.js";
import { getPlayerStats } from "../utils/financeStats.utils.js";

const userController = {
  getUser: async (req, res) => {
    try {
      const { id } = req.params;

      const user = await db.User.findByPk(id, {
        attributes: ["id", "username", "avatar", "description", "createdAt"],
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const stats = await getPlayerStats(user.id);

      res.status(200).json({
        user: {
          ...user.toJSON(),
          stats,
        }
      });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Error fetching user profile" });
    }
  },


  me: async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const user = await db.User.findByPk(req.user.id, {
        attributes: ["id", "username", "email", "avatar", "description", "createdAt"],
        include: [
          {
            model: db.User,
            as: "Friends",
            attributes: ["id", "username", "avatar"],
            through: { attributes: ["status", "createdAt"], where: { status: "accepted" } },
          },
          {
            model: db.User,
            as: "FriendOf",
            attributes: ["id", "username", "avatar"],
            through: { attributes: ["status", "createdAt"], where: { status: "accepted" } },
          },
        ]
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const stats = await getPlayerStats(user.id);

      const { Friends, FriendOf, ...userFields } = user.get({ plain: true });

      const seen = new Set();
      const allFriends = [...(Friends || []), ...(FriendOf || [])].filter(f => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });

      res.status(200).json({
        user: {
          ...userFields,
          stats,
          friends: allFriends,
        }
      });
    } catch (error) {
      console.error("getMe error:", error);
      res.status(500).json({ error: "Error fetching profile" });
    }
  },

  updateMe: async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { username, description } = req.body;
      const user = await db.User.findByPk(req.user.id);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // On construit un objet avec uniquement les champs fournis
      const fieldsToUpdate = {};

      if (username !== undefined && username !== user.username) {
        const usernameError = validateUsername(username);
        if (usernameError) return res.status(400).json({ error: usernameError });

        const taken = await findUserByUsername(username);
        if (taken && taken.id !== user.id) {
          return res.status(409).json({ error: "Username already taken" });
        }
        fieldsToUpdate.username = username;
      }

      // Bio vide → effacée
      if (description !== undefined) {
        const bio = String(description).trim();
        if (bio.length > 500) return res.status(400).json({ error: "Bio too long (500 characters max)" });
        fieldsToUpdate.description = bio || null;
      }

      // Avatar : uniquement un fichier uploadé (plus d'URL arbitraire envoyée en texte),
      // enregistré seulement une fois le reste du profil validé
      if (req.file) {
        try {
          fieldsToUpdate.avatar = await storeAvatar(req.file, user.id);
        } catch (error) {
          console.error("Avatar upload error:", error);
          return res.status(502).json({ error: "Avatar upload failed, please try again" });
        }
      }

      // Si aucun champ fourni → pas d’update
      if (Object.keys(fieldsToUpdate).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      await user.update(fieldsToUpdate);

      // Nouveau token : il contient le pseudo, utilisé dans les notifications envoyées aux autres
      const token = await generateToken(user);

      return res.status(200).json({
        message: "Profile updated",
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          description: user.description,
        },
        token,
      });
    } catch (error) {
      console.error("updateMe error:", error);
      res.status(500).json({ error: "Error updating profile" });
    }
  },



  deleteMe: async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const user = await db.User.findByPk(req.user.id);


      if (!user) return res.status(404).json({ error: "User not found" });

      // Anonymisé plutôt que supprimé (ses résultats restent dans les parties des autres).
      // Pseudo unique par compte (la colonne est unique) et mot de passe aléatoire : connexion impossible
      await user.update({
        email: `deleted_${user.id}@example.com`,
        username: `deleted_${user.id}`,
        password: await argon2.hash(randomUUID()),
        avatar: null,
        description: null,
      });

      try {
        await removeAvatar(user.id);
      } catch (error) {
        console.error("Avatar removal failed (non-blocking):", error);
      }

      res.status(200).json({ message: "Profile deleted" });
    } catch (error) {
      console.error("deleteMe error:", error);
      res.status(500).json({ error: "Error deleting profile" });
    }
  },

  searchByUsername: async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { username } = req.query;
      if (!username || username.trim() === "") {
        return res.status(400).json({ error: "Username is required" });
      }

      // % et _ tapés par l'utilisateur = caractères littéraux, pas des jokers SQL
      const pattern = username.trim().replace(/[\\%_]/g, "\\$&");

      const users = await db.User.findAll({
        where: {
          // Les comptes supprimés (pseudo "deleted_…") n'apparaissent pas
          username: { [Op.iLike]: `%${pattern}%`, [Op.notILike]: "deleted\\_%" },
          id: { [Op.ne]: req.user.id },
        },
        attributes: ["id", "username", "avatar"], // ce que tu veux exposer
        limit: 10,
      });

      return res.status(200).json({ users });
    } catch (error) {
      console.error("searchByUsername error:", error);
      return res.status(500).json({ error: "Error searching users" });
    }
  },
};

export default userController;
