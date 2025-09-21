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

  me: async (req, res) => {

    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    res.status(200).json({
      user: { id: req.user.id, username: req.user.username, email: req.user.email },
    });
  },

  updateMe: async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { username, avatar, description } = req.body;
      const user = await db.User.findByPk(req.user.id);

      if (!user) return res.status(404).json({ error: "User not found" });

      const fieldsToUpdate = {};
      if (username) fieldsToUpdate.username = username;
      if (avatar) fieldsToUpdate.avatar = avatar;
      if (description) fieldsToUpdate.description = description;

      await user.update(fieldsToUpdate);

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
};

export default userController;
