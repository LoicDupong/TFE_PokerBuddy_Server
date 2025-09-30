import db from "../models/index.js";

class FriendsService {
  /**
   * *Crée une demande d'ami (symétrique : 1 seule ligne en DB)
   */
  static async addFriend(userId, friendId) {
    if (userId === friendId) {
      throw new Error("Un utilisateur ne peut pas être ami avec lui-même");
    }

    // Vérifie la relation dans les deux sens
    const existing = await db.Friend.findOne({
      where: {
        [db.sequelize.Op.or]: [
          { userId, friendId },
          { userId: friendId, friendId: userId },
        ]
      }
    });

    if (existing) {
      throw new Error("Cette relation existe déjà");
    }

    // Toujours stocker avec userId < friendId pour la cohérence
    if (userId > friendId) {
      [userId, friendId] = [friendId, userId];
    }

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
    // Cherche la relation dans les deux sens
    const relation = await db.Friend.findOne({
      where: {
        [db.sequelize.Op.or]: [
          { userId, friendId },
          { userId: friendId, friendId: userId },
        ]
      }
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
    return await db.Friend.destroy({
      where: {
        [db.sequelize.Op.or]: [
          { userId, friendId },
          { userId: friendId, friendId: userId },
        ]
      }
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
