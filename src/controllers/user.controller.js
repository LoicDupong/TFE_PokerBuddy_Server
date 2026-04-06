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

      const user = await db.User.findByPk(id, {
        attributes: ["id", "username", "avatar", "description", "createdAt"],
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const gameResults = await db.GameResult.findAll({
        include: [
          {
            model: db.GamePlayer,
            as: "player",
            where: { userId: user.id },
            attributes: [],
          },
          {
            model: db.Game,
            as: "game",
            where: { status: "finished" },
            attributes: ["buyIn", "placesPaid", "dateEnd"],
          },
        ],
        attributes: ["rank", "prize"],
        order: [[{ model: db.Game, as: "game" }, "dateEnd", "ASC"]],
      });

      const totalGames = gameResults.length;
      const wins = gameResults.filter(r => r.rank === 1).length;
      const losses = totalGames - wins;
      const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : "0.0";
      const paidPlaces = gameResults.filter(r => r.rank <= r.game.placesPaid).length;
      const avgPlacement = totalGames > 0
        ? (gameResults.reduce((sum, r) => sum + r.rank, 0) / totalGames).toFixed(2)
        : null;
      const netResult = gameResults.reduce((sum, r) => sum + (r.prize - r.game.buyIn), 0);

      let bestStreak = 0, currentStreak = 0;
      for (const r of gameResults) {
        if (r.rank === 1) { currentStreak++; bestStreak = Math.max(bestStreak, currentStreak); }
        else { currentStreak = 0; }
      }

      const gamesHosted = await db.Game.count({ where: { hostId: user.id } });

      res.status(200).json({
        user: {
          ...user.toJSON(),
          stats: {
            totalGames,
            wins,
            losses,
            winRate,
            paidPlaces,
            avgPlacement,
            netResult,
            bestStreak,
            gamesHosted,
          },
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
            through: { attributes: ["status", "createdAt"], where: { status: "accepted" } },
          },
          {
            model: db.User,
            as: "FriendOf",
            attributes: ["id", "username", "email", "avatar"],
            through: { attributes: ["status", "createdAt"], where: { status: "accepted" } },
          },
        ]
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const gameResults = await db.GameResult.findAll({
        include: [
          {
            model: db.GamePlayer,
            as: "player",
            where: { userId: user.id },
            attributes: [],
          },
          {
            model: db.Game,
            as: "game",
            where: { status: "finished" },
            attributes: ["buyIn", "placesPaid", "dateEnd"],
          },
        ],
        attributes: ["rank", "prize"],
        order: [[{ model: db.Game, as: "game" }, "dateEnd", "ASC"]],
      });

      const totalGames = gameResults.length;
      const wins = gameResults.filter(r => r.rank === 1).length;
      const losses = totalGames - wins;
      const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : "0.0";
      const paidPlaces = gameResults.filter(r => r.rank <= r.game.placesPaid).length;
      const avgPlacement = totalGames > 0
        ? (gameResults.reduce((sum, r) => sum + r.rank, 0) / totalGames).toFixed(2)
        : null;
      const netResult = gameResults.reduce((sum, r) => sum + (r.prize - r.game.buyIn), 0);

      let bestStreak = 0, currentStreak = 0;
      for (const r of gameResults) {
        if (r.rank === 1) { currentStreak++; bestStreak = Math.max(bestStreak, currentStreak); }
        else { currentStreak = 0; }
      }

      const gamesHosted = await db.Game.count({ where: { hostId: user.id } });

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
          stats: {
            totalGames,
            wins,
            losses,
            winRate,
            paidPlaces,
            avgPlacement,
            netResult,
            bestStreak,
            gamesHosted,
          },
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
          username: { [Op.iLike]: `%${username}%` },
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
