import nodemailer from "nodemailer";

// Envoi d'emails via SMTP (Resend, Brevo, Mailtrap… : tous fournissent une URL SMTP).
// SMTP_URL ex. "smtps://resend:re_xxx@smtp.resend.com:465" ; MAIL_FROM ex. "PokerBuddy <no-reply@dupong.be>".
// Sans SMTP_URL (dev) : l'email est écrit dans la console et rien n'est envoyé.

const DEFAULT_FROM = "PokerBuddy <no-reply@localhost>";
// Environnements locaux où le contenu complet (lien compris) peut apparaître dans la console
const LOCAL_ENVS = new Set(["dev", "development", "test"]);

let transporter = null;
let transporterUrl = null;

function getTransporter(url) {
    // Recréé seulement si l'URL change (tests) ; sinon une connexion réutilisée pour tous les envois
    if (!transporter || transporterUrl !== url) {
        transporter = nodemailer.createTransport(url);
        transporterUrl = url;
    }
    return transporter;
}

// "loic@dupong.be" → "l***@dupong.be" : assez pour diagnostiquer, sans recopier l'adresse dans les logs
export function maskEmail(email) {
    const [local = "", domain = ""] = String(email ?? "").split("@");
    return `${local.slice(0, 1)}***@${domain || "?"}`;
}

export function formatConsoleMail({ from, to, subject, text }) {
    const line = "─".repeat(60);
    return [line, "📧 Email (not sent: SMTP_URL is not set)", `From: ${from}`, `To: ${to}`, `Subject: ${subject}`, "", text, line].join("\n");
}

/**
 * Envoie un email. Résout avec { delivered: boolean }, rejette si le serveur SMTP refuse :
 * l'appelant décide (pour le mot de passe oublié, l'erreur est seulement loguée).
 */
export async function sendMail({ to, subject, html, text }, env = process.env) {
    const from = env.MAIL_FROM || DEFAULT_FROM;

    if (!env.SMTP_URL) {
        if (LOCAL_ENVS.has(env.NODE_ENV)) {
            console.log(formatConsoleMail({ from, to, subject, text }));
        } else {
            // Hors dev, le contenu (lien de réinitialisation) ne doit jamais finir dans les logs de l'hébergeur
            console.error(`SMTP_URL is not set: email "${subject}" to ${maskEmail(to)} was not sent`);
        }
        return { delivered: false };
    }

    const info = await getTransporter(env.SMTP_URL).sendMail({ from, to, subject, html, text });
    return { delivered: true, messageId: info.messageId };
}
