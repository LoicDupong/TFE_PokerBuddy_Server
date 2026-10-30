import db from "../models/index.js";
import { Op } from "sequelize";
import { createNotification } from "../utils/notification.utils.js";
import { isUuid } from "../utils/validation.utils.js";

const friendController = {
    // Envoyer une invitation
    sendInvite: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const { friendId } = req.body;

            // Compte supprimé ou désactivé : introuvable, comme dans la recherche
            if (!isUuid(friendId) || !(await db.User.findOne({ where: { id: friendId, deletedAt: null, disabledAt: null }, attributes: ["id"] }))) {
                return res.status(404).json({ error: "User not found" });
            }

            if (req.user.id === friendId) {
                return res.status(400).json({ error: "You cannot add yourself as a friend" });
            }

            // L'autre m'a déjà envoyé une demande : la mienne vaut acceptation
            const reversePending = await db.Friend.findOne({
                where: { userId: friendId, friendId: req.user.id, status: "pending" },
            });
            if (reversePending) {
                await reversePending.update({ status: "accepted" });
                await createNotification(friendId, 'friend_accepted', `${req.user.username} accepted your friend request`, reversePending.id);
                return res.status(200).json({ message: "Friend request accepted", invite: reversePending });
            }

            const existing = await db.Friend.findOne({
                where: {
                    status: { [Op.ne]: "declined" },
                    [Op.or]: [
                        { userId: req.user.id, friendId },
                        { userId: friendId, friendId: req.user.id },
                    ],
                },
            });

            if (existing) {
                return res.status(400).json({ error: "Friend request already exists" });
            }

            // Reuse a declined record if it exists (avoids unique constraint on re-invite)
            const declined = await db.Friend.findOne({
                where: {
                    status: "declined",
                    [Op.or]: [
                        { userId: req.user.id, friendId },
                        { userId: friendId, friendId: req.user.id },
                    ],
                },
            });

            if (declined) {
                await declined.update({ userId: req.user.id, friendId, status: "pending" });
                await createNotification(friendId, 'friend_request', `${req.user.username} sent you a friend request`, declined.id);
                return res.status(201).json({ message: "Friend request sent", invite: declined });
            }

            const invite = await db.Friend.create({
                userId: req.user.id,
                friendId,
                status: "pending",
            });

            await createNotification(friendId, 'friend_request', `${req.user.username} sent you a friend request`, invite.id);
            res.status(201).json({ message: "Friend request sent", invite });
        } catch (error) {
            console.error("Send invite error:", error);
            res.status(500).json({ error: "Error sending friend request" });
        }
    },

    // Lister les invitations reçues (pending)
    getInvites: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });
            const invites = await db.Friend.findAll({
                where: { friendId: req.user.id, status: "pending" },
                include: [{ model: db.User, as: "User", attributes: ["id", "username", "avatar"] }],
            });
            res.status(200).json({ invites });
        } catch (error) {
            console.error("Get invites error:", error);
            res.status(500).json({ error: "Error fetching invites" });
        }
    },

    // Accepter ou refuser une invitation
    respondInvite: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });
            
            const { inviteId } = req.params;
            const { action } = req.body; // "accept" ou "decline"

            const invite = await db.Friend.findByPk(inviteId);
            if (!invite) return res.status(404).json({ error: "Invite not found" });

            if (invite.friendId !== req.user.id) {
                return res.status(403).json({ error: "Not authorized to respond to this invite" });
            }

            if (invite.status !== "pending") {
                return res.status(409).json({ error: "Invite already responded to" });
            }

            if (action === "accept") {
                await invite.update({ status: "accepted" });
                await createNotification(invite.userId, 'friend_accepted', `${req.user.username} accepted your friend request`, invite.id);
            } else if (action === "decline") {
                await invite.update({ status: "declined" });
            } else {
                return res.status(400).json({ error: "Invalid action" });
            }

            res.status(200).json({ message: `Invite ${action === "accept" ? "accepted" : "declined"}`, invite });
        } catch (error) {
            console.error("Respond invite error:", error);
            res.status(500).json({ error: "Error responding to invite" });
        }
    },

    // Lister ses amis (acceptés uniquement)
    getFriends: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const friends = await db.Friend.findAll({
                where: {
                    status: "accepted",
                    [Op.or]: [
                        { userId: req.user.id },
                        { friendId: req.user.id },
                    ],
                },
                include: [
                    { model: db.User, as: "User", attributes: ["id", "username"] },
                    { model: db.User, as: "FriendUser", attributes: ["id", "username"] },
                ],
            });

            res.status(200).json({ friends });
        } catch (error) {
            console.error("Get friends error:", error);
            res.status(500).json({ error: "Error fetching friends" });
        }
    },


    // Supprimer un ami
    removeFriend: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });
            const { friendId } = req.params;
            const friendship = await db.Friend.findOne({
                where: {
                    status: "accepted",
                    [Op.or]: [
                        { userId: req.user.id, friendId },
                        { userId: friendId, friendId: req.user.id },
                    ],
                },
            });
            if (!friendship) {
                return res.status(404).json({ error: "Friendship not found" });
            } 
            await friendship.destroy();
            res.status(200).json({ message: "Friend removed" });
        } catch (error) {
            console.error("Remove friend error:", error);
            res.status(500).json({ error: "Error removing friend" });
        }
    }
};

export default friendController;