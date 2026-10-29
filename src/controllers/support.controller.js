import db from "../models/index.js";
import { sendMail } from "../utils/mail.utils.js";
import {
    buildTicketMail, toMessageView, toTicketView, validateMessageBody, validateTicketInput,
} from "../utils/support.utils.js";

// Le ticket n'est jamais cherché par id seul : toujours { id, userId } → le ticket d'un autre est un 404
const findOwnTicket = (id, userId, options = {}) => db.SupportTicket.findOne({ where: { id, userId }, ...options });

const supportController = {
    createTicket: async (req, res) => {
        try {
            const parsed = validateTicketInput(req.body);
            if (parsed.error) return res.status(400).json({ error: parsed.error });
            const { category, subject, body } = parsed.value;

            const ticket = await db.sequelize.transaction(async (transaction) => {
                const created = await db.SupportTicket.create(
                    { userId: req.user.id, category, subject, lastMessageAt: new Date() }, { transaction });
                await db.SupportMessage.create(
                    { ticketId: created.id, authorId: req.user.id, isStaff: false, body }, { transaction });
                return created;
            });

            // Email à l'équipe : optionnel et non bloquant (après le commit)
            if (process.env.SUPPORT_EMAIL) {
                sendMail({ to: process.env.SUPPORT_EMAIL, ...buildTicketMail({ ticket, username: req.user.username, body }) })
                    .catch((err) => console.error("Support email failed (non-blocking):", err.message));
            }

            return res.status(201).json({ ticket: toTicketView(ticket) });
        } catch (error) {
            console.error("createTicket error:", error);
            return res.status(500).json({ error: "Error creating support ticket" });
        }
    },

    listMyTickets: async (req, res) => {
        try {
            const tickets = await db.SupportTicket.findAll({
                where: { userId: req.user.id },
                order: [["lastMessageAt", "DESC"]],
                limit: 100,
            });
            return res.status(200).json({ tickets: tickets.map(toTicketView) });
        } catch (error) {
            console.error("listMyTickets error:", error);
            return res.status(500).json({ error: "Error fetching support tickets" });
        }
    },

    getMyTicket: async (req, res) => {
        try {
            const ticket = await findOwnTicket(req.params.id, req.user.id, {
                include: [{ model: db.SupportMessage, as: "messages" }],
                order: [[{ model: db.SupportMessage, as: "messages" }, "createdAt", "ASC"]],
            });
            if (!ticket) return res.status(404).json({ error: "Ticket not found" });
            return res.status(200).json({
                ticket: { ...toTicketView(ticket), messages: ticket.messages.map((m) => toMessageView(m)) },
            });
        } catch (error) {
            console.error("getMyTicket error:", error);
            return res.status(500).json({ error: "Error fetching support ticket" });
        }
    },

    addMyMessage: async (req, res) => {
        try {
            const parsed = validateMessageBody(req.body?.message);
            if (parsed.error) return res.status(400).json({ error: parsed.error });

            const ticket = await findOwnTicket(req.params.id, req.user.id);
            if (!ticket) return res.status(404).json({ error: "Ticket not found" });

            const message = await db.sequelize.transaction(async (transaction) => {
                const created = await db.SupportMessage.create(
                    { ticketId: ticket.id, authorId: req.user.id, isStaff: false, body: parsed.body }, { transaction });
                // Un ticket résolu qui reçoit une réponse de l'utilisateur est rouvert
                ticket.lastMessageAt = created.createdAt;
                if (ticket.status === "resolved") ticket.status = "new";
                await ticket.save({ transaction });
                return created;
            });

            return res.status(201).json({ message: toMessageView(message), ticket: toTicketView(ticket) });
        } catch (error) {
            console.error("addMyMessage error:", error);
            return res.status(500).json({ error: "Error sending message" });
        }
    },
};

export default supportController;
