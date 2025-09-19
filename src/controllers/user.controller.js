import db from "../models/index.js"; // Sequelize models

const userController = {
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
        attributes: ["id", "username", "email", "avatar", "description"], // pas de password
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.status(200).json({ user });
    } catch (error) {
      res.status(500).json({ error: "Error fetching user profile" });
    }
  },

  updateUser: async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;

      // ✅ Comparaison avec BIGINT
      if (Number(req.user.id) !== Number(id)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { username, email, avatar, description } = req.body;
      const user = await db.User.findByPk(id);

      if (!user) return res.status(404).json({ error: "User not found" });

      await user.update({ username, email, avatar, description });

      res.status(200).json({
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
      res.status(500).json({ error: "Error updating profile" });
    }
  },

  deleteUser: async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;

      // ✅ Comparaison avec BIGINT
      if (Number(req.user.id) !== Number(id)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const user = await db.User.findByPk(id);
      if (!user) return res.status(404).json({ error: "User not found" });

      await user.destroy();

      res.status(200).json({ message: "Profile deleted" });
    } catch (error) {
      res.status(500).json({ error: "Error deleting profile" });
    }
  },
};

export default userController;
