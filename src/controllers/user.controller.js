import { Op } from "sequelize";
import db from "../models/index.js"; // Sequelize models

const userController = {
  //* Dev purposes
  getAllUsers: async (req, res) => {
    try {

      const users = await db.User.findAll({
        attributes: ["id", "username", "email", "password", "avatar", "description"],
      });
      res.status(200).json({ users });
    } catch (error) {
      res.status(500).json({ error: "Error fetching users" });
    }
  },
  getUser: async (req, res) => {
    try {
      const { id } = req.params;
      console.log(id);

      const user = await db.User.findByPk(id, {
        attributes: ["id", "username", "avatar", "description", "createdAt"],
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Total games played
      const totalGames = await db.GamePlayer.count({
        where: { userId: user.id },
        include: [{
          model: db.Game,
          as: "game",
          where: { status: "finished" }
        }]
      });

      // Total games won (position = 1)
      const totalGamesWon = await db.GameResult.count({
        include: [
          {
            model: db.GamePlayer,
            as: "player",
            where: { userId: user.id }
          },
          {
            model: db.Game,
            as: "game",
            where: { status: "finished" }
          }
        ],
        where: { rank: 1 }
      });

      // Win rate %
      const winRate = totalGames > 0 ? ((totalGamesWon / totalGames) * 100).toFixed(1) : 0;

      // Games hosted
      const gamesHosted = await db.Game.count({
        where: { hostId: user.id }
      });

      res.status(200).json({
        user: {
          ...user.toJSON(),
          stats: {
            totalGames,
            totalGamesWon,
            winRate,
            gamesHosted
          },
          friends: user.Friends,
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
            attributes: ["id", "username", "email", "avatar"],
            through: { attributes: ["status", "createdAt"] },
          },
        ]
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Total games played
      const totalGames = await db.GamePlayer.count({
        where: { userId: user.id },
        include: [{
          model: db.Game,
          as: "game",
          where: { status: "finished" }
        }]
      });

      // Total games won (position = 1)
      const totalGamesWon = await db.GameResult.count({
        include: [
          {
            model: db.GamePlayer,
            as: "player",
            where: { userId: user.id }
          },
          {
            model: db.Game,
            as: "game",
            where: { status: "finished" }
          }
        ],
        where: { rank: 1 }
      });

      // Win rate %
      const winRate = totalGames > 0 ? ((totalGamesWon / totalGames) * 100).toFixed(1) : 0;

      // Games hosted
      const gamesHosted = await db.Game.count({
        where: { hostId: user.id }
      });

      res.status(200).json({
        user: {
          ...user.toJSON(),
          stats: {
            totalGames,
            totalGamesWon,
            winRate,
            gamesHosted
          },
          friends: user.Friends,
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

      const { username, avatar, description } = req.body;
      const user = await db.User.findByPk(req.user.id);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // On construit un objet avec uniquement les champs fournis
      const fieldsToUpdate = {};
      if (username) fieldsToUpdate.username = username;
      if (description) fieldsToUpdate.description = description;

      // Gestion de l’avatar : priorité au fichier uploadé
      if (req.file) {
        fieldsToUpdate.avatar = `/uploads/avatars/${req.file.filename}`;
      } else if (avatar) {
        fieldsToUpdate.avatar = avatar; // si avatar en string (url)
      }

      // Si aucun champ fourni → pas d’update
      if (Object.keys(fieldsToUpdate).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      await user.update(fieldsToUpdate);

      return res.status(200).json({
        message: "Profile updated",
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          description: user.description,
        },
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

      await user.update({
        email: `deleted_${user.id}@example.com`,
        username: "Deleted user",
        avatar: null,
        description: null,
      });

      res.status(200).json({ message: "Profile deleted" });
    } catch (error) {

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

      const users = await db.User.findAll({
        where: {
          username: { [Op.iLike]: `%${username}%` }, // recherche insensible à la casse
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
