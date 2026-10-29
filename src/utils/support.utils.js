// Validation et helpers du support (tickets d'aide). Fonctions pures : testées dans test/support.utils.test.js.

export const SUPPORT_CATEGORIES = ["bug", "account", "game", "suggestion", "other"];
export const SUPPORT_STATUSES = ["new", "in_progress", "resolved"];
export const SUBJECT_MAX = 120;
export const MESSAGE_MAX = 4000;

// Un texte fait d'espaces est vide
const clean = (value) => (typeof value === "string" ? value.trim() : "");

export function validateMessageBody(message) {
    const body = clean(message);
    if (!body) return { error: "Message is required" };
    if (body.length > MESSAGE_MAX) return { error: `Message must be at most ${MESSAGE_MAX} characters` };
    return { body };
}

export function validateTicketInput({ category, subject, message } = {}) {
    if (!SUPPORT_CATEGORIES.includes(category)) return { error: "Invalid category" };
    const cleanSubject = clean(subject);
    if (!cleanSubject) return { error: "Subject is required" };
    if (cleanSubject.length > SUBJECT_MAX) return { error: `Subject must be at most ${SUBJECT_MAX} characters` };
    const body = validateMessageBody(message);
    if (body.error) return { error: body.error };
    return { value: { category, subject: cleanSubject, body: body.body } };
}

// Pagination commune des listes admin : ?page=1&pageSize=20 (max 100)
export function parsePagination(query = {}) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
    return { page, pageSize, offset: (page - 1) * pageSize };
}

// Les % et _ saisis par l'admin sont des caractères littéraux dans un ILIKE
export const escapeLike = (text) => String(text).replace(/[\\%_]/g, (c) => `\\${c}`);

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

// Email de notification à l'équipe (SUPPORT_EMAIL) quand un ticket est créé
export function buildTicketMail({ ticket, username, body }) {
    const subject = `[PokerBuddy support] ${ticket.subject}`.slice(0, 200);
    const text = `New ${ticket.category} ticket from ${username}\n\nSubject: ${ticket.subject}\nTicket: ${ticket.id}\n\n${body}`;
    const html = `<p>New <b>${escapeHtml(ticket.category)}</b> ticket from <b>${escapeHtml(username)}</b></p>`
        + `<p>Subject: ${escapeHtml(ticket.subject)}<br>Ticket: ${escapeHtml(ticket.id)}</p>`
        + `<p style="white-space:pre-wrap">${escapeHtml(body)}</p>`;
    return { subject, text, html };
}

// Vue d'un message : l'utilisateur ne voit jamais l'identité d'un membre du staff
export function toMessageView(message, { forAdmin = false } = {}) {
    const view = { id: message.id, isStaff: message.isStaff, body: message.body, createdAt: message.createdAt };
    if (forAdmin) view.author = message.author ? { id: message.author.id, username: message.author.username } : null;
    return view;
}

export function toTicketView(ticket) {
    return {
        id: ticket.id,
        category: ticket.category,
        subject: ticket.subject,
        status: ticket.status,
        lastMessageAt: ticket.lastMessageAt,
        createdAt: ticket.createdAt,
    };
}
