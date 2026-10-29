import { assertParams, renderEmailHtml, renderEmailText } from "./layout.js";

// Email "mot de passe oublié". Phrases complètes par langue (pas de fragments concaténés) pour l'i18n.
const COPY = {
    en: {
        subject: "Reset your PokerBuddy password",
        title: "Forgot your password?",
        preheader: ({ expiresInMinutes }) => `Pick a new one. The link works for ${expiresInMinutes} minutes.`,
        greeting: ({ username }) => `Hey ${username},`,
        paragraphs: ({ expiresInMinutes }) => [
            "Someone (hopefully you) asked to reset the password of your PokerBuddy account. Follow the link below to choose a new one.",
            `The link works for ${expiresInMinutes} minutes and only once. Once your new password is saved, every device signed in to your account is logged out.`,
        ],
        cta: "Choose a new password",
        fallbackLabel: "Button not working? Copy this link into your browser:",
        note: "Didn't ask for this? Just ignore this email: your password stays the same, and nobody can change it without this link.",
        footer: "PokerBuddy · Home poker nights, made simple",
    },
    fr: {
        subject: "Réinitialise ton mot de passe PokerBuddy",
        title: "Mot de passe oublié ?",
        preheader: ({ expiresInMinutes }) => `Choisis-en un nouveau. Le lien est valable ${expiresInMinutes} minutes.`,
        greeting: ({ username }) => `Salut ${username},`,
        paragraphs: ({ expiresInMinutes }) => [
            "Quelqu'un (toi, on espère) a demandé à réinitialiser le mot de passe de ton compte PokerBuddy. Suis le lien ci-dessous pour en choisir un nouveau.",
            `Le lien est valable ${expiresInMinutes} minutes et une seule fois. Dès que ton nouveau mot de passe est enregistré, tous les appareils connectés à ton compte sont déconnectés.`,
        ],
        cta: "Choisir un nouveau mot de passe",
        fallbackLabel: "Le bouton ne marche pas ? Copie ce lien dans ton navigateur :",
        note: "Tu n'as rien demandé ? Ignore simplement cet email : ton mot de passe ne change pas, et personne ne peut le modifier sans ce lien.",
        footer: "PokerBuddy · Tes soirées poker, en toute simplicité",
    },
};

/**
 * @param {{ username: string, resetUrl: string, expiresInMinutes?: number }} params
 * @param {"en"|"fr"} [locale]
 * @returns {{ subject: string, html: string, text: string }}
 */
export default function passwordResetEmail(params, locale = "en") {
    const p = { expiresInMinutes: 30, ...params };
    assertParams(p, ["username", "resetUrl", "expiresInMinutes"], "password-reset");

    const lang = COPY[locale] ? locale : "en";
    const copy = COPY[lang];
    const content = {
        lang,
        title: copy.title,
        preheader: copy.preheader(p),
        greeting: copy.greeting(p),
        paragraphs: copy.paragraphs(p),
        cta: { label: copy.cta, url: p.resetUrl },
        fallbackLabel: copy.fallbackLabel,
        note: copy.note,
        footer: copy.footer,
    };

    return {
        subject: copy.subject,
        html: renderEmailHtml(content),
        text: renderEmailText(content),
    };
}

export { passwordResetEmail };
