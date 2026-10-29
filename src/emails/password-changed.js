import { assertParams, renderEmailHtml, renderEmailText } from "./layout.js";

// Alerte de sécurité envoyée après chaque changement de mot de passe (reset ou réglages du compte) :
// si ce n'était pas le titulaire, il est prévenu et peut reprendre la main.
const COPY = {
    en: {
        subject: "Your PokerBuddy password was changed",
        title: "Password changed",
        preheader: "If it was you, you're all set.",
        greeting: ({ username }) => `Hey ${username},`,
        paragraphs: () => [
            "The password of your PokerBuddy account was just changed, and your other devices were logged out.",
            "If it was you, you're all set: nothing else to do.",
        ],
        cta: "Not you? Reset your password",
        fallbackLabel: "Button not working? Copy this link into your browser:",
        note: "If you didn't change your password, reset it right away with the link above, then check the email address of your account.",
        footer: "PokerBuddy · Home poker nights, made simple",
    },
    fr: {
        subject: "Ton mot de passe PokerBuddy a été modifié",
        title: "Mot de passe modifié",
        preheader: "Si c'était toi, tout est en ordre.",
        greeting: ({ username }) => `Salut ${username},`,
        paragraphs: () => [
            "Le mot de passe de ton compte PokerBuddy vient d'être modifié, et tes autres appareils ont été déconnectés.",
            "Si c'était toi, tout est en ordre : tu n'as rien d'autre à faire.",
        ],
        cta: "Pas toi ? Réinitialise ton mot de passe",
        fallbackLabel: "Le bouton ne marche pas ? Copie ce lien dans ton navigateur :",
        note: "Si tu n'as pas changé ton mot de passe, réinitialise-le tout de suite avec le lien ci-dessus.",
        footer: "PokerBuddy · Tes soirées poker, en toute simplicité",
    },
};

/**
 * @param {{ username: string, forgotPasswordUrl: string }} params
 * @param {"en"|"fr"} [locale]
 * @returns {{ subject: string, html: string, text: string }}
 */
export default function passwordChangedEmail(params, locale = "en") {
    assertParams(params, ["username", "forgotPasswordUrl"], "password-changed");

    const lang = COPY[locale] ? locale : "en";
    const copy = COPY[lang];
    const content = {
        lang,
        title: copy.title,
        preheader: copy.preheader,
        greeting: copy.greeting(params),
        paragraphs: copy.paragraphs(params),
        cta: { label: copy.cta, url: params.forgotPasswordUrl },
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

export { passwordChangedEmail };
