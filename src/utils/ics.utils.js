// Générateur iCalendar (RFC 5545) partagé par GET /api/games/:id/ics et GET /api/join/:token/ics.
// Fonctions pures (aucun import de models/) : testées avec node --test.

// Une soirée poker dure ~3 h : aucune heure de fin n'est saisie à la création
export const GAME_DURATION_MS = 3 * 60 * 60 * 1000;

// Le même UID pour les deux routes : réimporter la partie met l'événement à jour au lieu de le dupliquer
export const gameIcsUid = (gameId) => `${gameId}@pokerbuddy`;

// Toujours en UTC avec le "Z" final : sans lui, les agendas liraient l'heure comme locale.
// Pas besoin de VTIMEZONE, l'agenda convertit dans le fuseau de l'appareil.
export function formatIcsDate(date) {
    return new Date(date).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// Échappement d'une valeur TEXT (§3.3.11) : \ ; , et retours à la ligne.
// Les caractères de contrôle (sauf tabulation) sont interdits dans une ligne : on les retire.
export function escapeIcsText(value) {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r\n|\r|\n/g, "\\n")
        .replace(/[\u0000-\u0008\u000A-\u001F\u007F]/g, "");
}

// Pliage (§3.1) : 75 octets max par ligne, la suite commence par une espace (qui compte dans les 75).
// On découpe par caractère et non par octet pour ne jamais couper un caractère UTF-8 multi-octets.
export function foldIcsLine(line) {
    const parts = [];
    let current = "";
    let size = 0;
    let limit = 75;
    for (const char of line) {
        const bytes = Buffer.byteLength(char, "utf8");
        if (size + bytes > limit) {
            parts.push(current);
            current = char;
            size = bytes;
            limit = 74;
        } else {
            current += char;
            size += bytes;
        }
    }
    parts.push(current);
    return parts.join("\r\n ");
}

// URL http(s) valide ou rien : une valeur URI n'est pas échappée, elle ne doit donc pas pouvoir
// injecter un retour à la ligne (et une nouvelle propriété) dans le fichier
function safeUrl(url) {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
    } catch {
        return null;
    }
}

// Lien de la page d'invitation, si l'URL du client (APP_URL, optionnelle) est connue
export function joinInviteUrl(token, appUrl) {
    if (!appUrl) return null;
    const base = safeUrl(appUrl);
    if (!base) return null;
    return new URL(`join/${encodeURIComponent(token)}`, base.endsWith("/") ? base : `${base}/`).href;
}

const present = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Construit un fichier .ics d'un seul événement.
 * @param {{ uid: string, start: Date|string, durationMs?: number, summary: string,
 *           location?: string|null, description?: string|null, url?: string|null, now?: Date }} event
 * @returns {string} contenu iCalendar, lignes terminées par CRLF
 */
export function buildGameIcs({ uid, start, durationMs = GAME_DURATION_MS, summary, location, description, url, now = new Date() }) {
    const startDate = new Date(start);
    const end = new Date(startDate.getTime() + durationMs);
    const link = safeUrl(url);

    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//PokerBuddy//EN",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${formatIcsDate(now)}`,
        `DTSTART:${formatIcsDate(startDate)}`,
        `DTEND:${formatIcsDate(end)}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        present(location) ? `LOCATION:${escapeIcsText(location.trim())}` : null,
        present(description) ? `DESCRIPTION:${escapeIcsText(description.trim())}` : null,
        link ? `URL:${link}` : null,
        "END:VEVENT",
        "END:VCALENDAR",
    ];

    // Chaque ligne, la dernière comprise, se termine par CRLF (§3.1)
    return lines.filter(Boolean).map(foldIcsLine).join("\r\n") + "\r\n";
}

// Nom de fichier ASCII lisible ("friday-night-poker.ics") : pas d'accents ni d'emoji dans l'en-tête HTTP
export function icsFilename(name) {
    const slug = String(name ?? "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 50)
        .replace(/-+$/g, "");
    return `${slug || "poker-game"}.ics`;
}
