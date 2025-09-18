import db from "../models/index.js";

class FriendsService {
  /**
   * *Crée une demande d'ami (symétrique : 1 seule ligne en DB)
   */
  static async addFriend(userId, friendId) {
    // Empêche l'auto-relation
    if (userId === friendId) {
      throw new Error("Un utilisateur ne peut pas être ami avec lui-même");
    }

    // Forcer la symétrie : userId < friendId
    if (userId > friendId) {
      [userId, friendId] = [friendId, userId];
    }

    // Vérifie si la relation existe déjà
    const existing = await db.Friend.findOne({
      where: { userId, friendId },
    });

    if (existing) {
      throw new Error("Cette relation existe déjà");
    }

    // Crée la relation en status pending
    return await db.Friend.create({
      userId,
      friendId,
      status: "pending",
    });
  }

  /**
   * *Accepte une demande d'ami
   */
  static async acceptFriend(userId, friendId) {
    if (userId > friendId) {
      [userId, friendId] = [friendId, userId];
    }

    const relation = await db.Friend.findOne({
      where: { userId, friendId },
    });

    if (!relation) {
      throw new Error("Relation introuvable");
    }

    relation.status = "accepted";
    return await relation.save();
  }

  /**
   * *Refuse / supprime une demande d'ami
   */
  static async removeFriend(userId, friendId) {
    if (userId > friendId) {
      [userId, friendId] = [friendId, userId];
    }

    return await db.Friend.destroy({
      where: { userId, friendId },
    });
  }

  /**
   * *Liste les amis acceptés d'un utilisateur
   */
  static async getFriends(userId) {
    return await db.Friend.findAll({
      where: {
        status: "accepted",
        [db.sequelize.Op.or]: [
          { userId },
          { friendId: userId },
        ],
      },
    });
  }
}

export default FriendsService;
