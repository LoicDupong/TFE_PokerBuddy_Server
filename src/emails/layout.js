// Mise en page commune des emails PokerBuddy.
// HTML "à l'ancienne" (tables + styles en ligne) : c'est ce que Gmail, Outlook et Apple Mail rendent
// de façon fiable. Aucune image externe : le logo est un texte stylé, rien n'est bloqué par défaut.

// Couleurs du thème du client (globals.scss)
export const BRAND = {
    navy: "#1a1b26",
    card: "#24263a",
    border: "#3a3d5c",
    red: "#d70022",
    redText: "#ff5468",
    periwinkle: "#9fa5df",
    text: "#fff3f3",
    muted: "#a9adc6",
};

const FONT = "Arial, Helvetica, sans-serif";

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
    })[char]);
}

// Les gabarits reçoivent des chaînes déjà prêtes : un paramètre manquant doit planter ici,
// jamais produire un email contenant "undefined"
export function assertParams(params, keys, template) {
    for (const key of keys) {
        if (params?.[key] === undefined || params[key] === null || params[key] === "") {
            throw new Error(`Email "${template}": missing parameter "${key}"`);
        }
    }
}

const paragraph = (text) =>
    `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${BRAND.text};">${escapeHtml(text)}</p>`;

function button({ label, url }) {
    const href = escapeHtml(url);
    return `
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0;">
  <tr>
    <td align="center" bgcolor="${BRAND.red}" style="border-radius:8px;background-color:${BRAND.red};">
      <a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:bold;letter-spacing:0.5px;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

/**
 * @param {object} content
 * @param {string} content.lang       "en" | "fr"
 * @param {string} content.title      <title> et titre principal
 * @param {string} content.preheader  aperçu affiché par la boîte mail à côté du sujet
 * @param {string} content.greeting
 * @param {string[]} content.paragraphs
 * @param {{label: string, url: string}} [content.cta]
 * @param {string} [content.fallbackLabel]  texte avant le lien en clair (bouton non cliquable)
 * @param {string} [content.note]           texte secondaire (ex. "ce n'était pas vous ?")
 * @param {string} content.footer
 */
export function renderEmailHtml({ lang, title, preheader, greeting, paragraphs, cta, fallbackLabel, note, footer }) {
    const fallback = cta && fallbackLabel ? `
<p style="margin:0 0 8px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.muted};">${escapeHtml(fallbackLabel)}</p>
<p style="margin:0 0 24px 0;font-family:${FONT};font-size:13px;line-height:20px;word-break:break-all;"><a href="${escapeHtml(cta.url)}" target="_blank" rel="noopener noreferrer" style="color:${BRAND.periwinkle};text-decoration:underline;">${escapeHtml(cta.url)}</a></p>` : "";

    const noteHtml = note ? `
<p style="margin:0;padding-top:16px;border-top:1px solid ${BRAND.border};font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.muted};">${escapeHtml(note)}</p>` : "";

    return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.navy};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${BRAND.navy}" style="background-color:${BRAND.navy};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr>
          <td style="padding:0 0 20px 4px;font-family:${FONT};font-size:24px;font-weight:bold;letter-spacing:0.5px;color:${BRAND.text};">
            <span style="color:${BRAND.red};">&#9824;</span> Poker<span style="color:${BRAND.redText};">Buddy</span>
          </td>
        </tr>
        <tr>
          <td bgcolor="${BRAND.card}" style="background-color:${BRAND.card};border:1px solid ${BRAND.border};border-top:4px solid ${BRAND.red};border-radius:12px;padding:28px 24px;">
            <h1 style="margin:0 0 20px 0;font-family:${FONT};font-size:22px;line-height:28px;font-weight:bold;color:${BRAND.text};">${escapeHtml(title)}</h1>
            ${paragraph(greeting)}
            ${paragraphs.map(paragraph).join("\n            ")}
            ${cta ? button(cta) : ""}
            ${fallback}
            ${noteHtml}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.muted};">${escapeHtml(footer)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function renderEmailText({ title, greeting, paragraphs, cta, note, footer }) {
    const parts = [title, "", greeting, "", ...paragraphs.flatMap((p) => [p, ""])];
    if (cta) parts.push(`${cta.label}:`, cta.url, "");
    if (note) parts.push(note, "");
    parts.push("--", footer);
    return parts.join("\n");
}
