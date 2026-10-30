import { Op } from "sequelize";
import db from "../models/index.js";
import { createNotification } from "../utils/notification.utils.js";
import { logAdminAction } from "../utils/adminAudit.utils.js";
import {
    SUPPORT_STATUSES, escapeLike, parsePagination, toMessageView, toTicketView, validateMessageBody,
} from "../utils/support.utils.js";

const userAttributes = ["id", "username"];

const adminTicketView = (ticket) => ({
    ...toTicketView(ticket),
    user: ticket.user ? { id: ticket.user.id, username: ticket.user.username } : null,
});

const adminSupportController = {
    listTickets: async (req, res) => {
        try {
            const { page, pageSize, offset } = parsePagination(req.query);
            const where = {};
            if (req.query.status !== undefined && req.query.status !== "") {
                if (!SUPPORT_STATUSES.includes(req.query.status)) return res.status(400).json({ error: "Invalid status" });
                where.status = req.query.status;
            }
            const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
            if (q) {
                const like = `%${escapeLike(q)}%`;
                where[Op.or] = [{ subject: { [Op.iLike]: like } }, { "$user.username$": { [Op.iLike]: like } }];
            }

            const { rows, count } = await db.SupportTicket.findAndCountAll({
                where,
                include: [{ model: db.User, as: "user", attributes: userAttributes, required: true }],
                order: [["lastMessageAt", "DESC"]],
                limit: pageSize,
                offset,
                distinct: true,
                subQuery: false,
            });
            return res.status(200).json({ items: rows.map(adminTicketView), total: count, page, pageSize });
        } catch (error) {
            console.error("admin listTickets error:", error);
            return res.status(500).json({ error: "Error fetching support tickets" });
        }
    },

    getTicket: async (req, res) => {
        try {
            const ticket = await db.SupportTicket.findByPk(req.params.id, {
                include: [
                    { model: db.User, as: "user", attributes: userAttributes },
                    { model: db.SupportMessage, as: "messages", include: [{ model: db.User, as: "author", attributes: userAttributes }] },
                ],
                order: [[{ model: db.SupportMessage, as: "messages" }, "createdAt", "ASC"]],
            });
            if (!ticket) return res.status(404).json({ error: "Ticket not found" });
            return res.status(200).json({
                ticket: { ...adminTicketView(ticket), messages: ticket.messages.map((m) => toMessageView(m, { forAdmin: true })) },
            });
        } catch (error) {
            console.error("admin getTicket error:", error);
            return res.status(500).json({ error: "Error fetching support ticket" });
        }
    },

    addMessage: async (req, res) => {
        try {
            const parsed = validateMessageBody(req.body?.message);
            if (parsed.error) return res.status(400).json({ error: parsed.error });

            const ticket = await db.SupportTicket.findByPk(req.params.id);
            if (!ticket) return res.status(404).json({ error: "Ticket not found" });

            const message = await db.sequelize.transaction(async (transaction) => {
                const created = await db.SupportMessage.create(
                    { ticketId: ticket.id, authorId: req.user.id, isStaff: true, body: parsed.body }, { transaction });
                ticket.lastMessageAt = created.createdAt;
                // Première réponse du staff : le ticket est pris en charge
                if (ticket.status === "new") ticket.status = "in_progress";
                await ticket.save({ transaction });
                // Audit dans la même transaction ; le corps du message n'est jamais journalisé (vie privée)
                await logAdminAction({
                    actorId: req.user.id, action: "support.reply", targetType: "support_ticket", targetId: ticket.id,
                    details: { messageId: created.id, status: ticket.status },
                }, { transaction });
                return created;
            });

            // Notification de l'auteur, après le commit
            await createNotification(ticket.userId, "support_reply", `Support replied to "${ticket.subject}"`, ticket.id);

            return res.status(201).json({ message: toMessageView(message, { forAdmin: true }), ticket: toTicketView(ticket) });
        } catch (error) {
            console.error("admin addMessage error:", error);
            return res.status(500).json({ error: "Error sending message" });
        }
    },

    updateTicket: async (req, res) => {
        try {
            const { status } = req.body ?? {};
            if (!SUPPORT_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });

            const ticket = await db.SupportTicket.findByPk(req.params.id);
            if (!ticket) return res.status(404).json({ error: "Ticket not found" });

            const previousStatus = ticket.status;
            if (previousStatus !== status) {
                await db.sequelize.transaction(async (transaction) => {
                    ticket.status = status;
                    await ticket.save({ transaction });
                    await logAdminAction({
                        actorId: req.user.id, action: "support.status", targetType: "support_ticket", targetId: ticket.id,
                        details: { from: previousStatus, to: status },
                    }, { transaction });
                });
            }
            return res.status(200).json({ ticket: toTicketView(ticket) });
        } catch (error) {
            console.error("admin updateTicket error:", error);
            return res.status(500).json({ error: "Error updating ticket" });
        }
    },
};

export default adminSupportController;
