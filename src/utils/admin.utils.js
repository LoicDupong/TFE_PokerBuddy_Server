// Logique pure du back-office (aucun import de models/) : testable sans base de données.

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const USER_ROLES = ["user", "admin"];
export const USER_STATUSES = ["active", "disabled", "deleted"];
export const GAME_STATUSES = ["pending", "active", "finished"];
// Longueur max des textes libres saisis par un admin (raison d'une désactivation, d'une annulation)
export const MAX_REASON_LENGTH = 500;

const toPositiveInt = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * ?page=&pageSize=&q= → valeurs sûres. Valeurs absentes ou invalides : défauts ;
 * pageSize plafonné à 100 (pas d'erreur : un client qui demande plus reçoit 100 lignes).
 */
export function parsePagination(query = {}) {
    const page = toPositiveInt(query.page) ?? 1;
    const pageSize = Math.min(toPositiveInt(query.pageSize) ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
    return { page, pageSize, q, limit: pageSize, offset: (page - 1) * pageSize };
}

export const paginated = (items, total, { page, pageSize }) => ({ items, total, page, pageSize });

// LIKE : le texte cherché est une valeur littérale, pas un motif
export const escapeLike = (value) => value.replace(/[\\%_]/g, "\\$&");

// Un compte supprimé reste supprimé même s'il avait été désactivé avant
export function userStatus(user) {
    if (user.deletedAt) return "deleted";
    if (user.disabledAt) return "disabled";
    return "active";
}

// Raison optionnelle : absente → null ; sinon chaîne non vide et bornée (message d'erreur, ou null si valide)
export function validateReason(reason) {
    if (reason === undefined || reason === null || reason === "") return null;
    if (typeof reason !== "string") return "Reason must be a string";
    if (reason.trim().length > MAX_REASON_LENGTH) return `Reason must be at most ${MAX_REASON_LENGTH} characters`;
    return null;
}
export const cleanReason = (reason) => (typeof reason === "string" && reason.trim() ? reason.trim() : null);

/**
 * Décision du script de promotion (scripts/grant-admin.mjs) à partir des deux recherches :
 * le compte trouvé par le pseudo et celui trouvé par l'email doivent être le même, et actif.
 * @returns {{ action: "not_found"|"mismatch"|"inactive"|"already_admin"|"grant", userId?: string }}
 */
export function decideGrant(byUsername, byEmail) {
    if (!byUsername || !byEmail) return { action: "not_found" };
    if (byUsername.id !== byEmail.id) return { action: "mismatch" };
    if (byUsername.deletedAt || byUsername.disabledAt) return { action: "inactive", userId: byUsername.id };
    if (byUsername.role === "admin") return { action: "already_admin", userId: byUsername.id };
    return { action: "grant", userId: byUsername.id };
}

// Arguments du script : --username <u> --email <e> [--dry-run] (forme --clé=valeur acceptée)
export function parseGrantArgs(argv) {
    const args = { username: null, email: null, dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        const [flag, inline] = argv[i].split(/=(.*)/s);
        if (flag === "--dry-run") args.dryRun = true;
        else if (flag === "--username" || flag === "--email") {
            const value = inline ?? argv[++i];
            args[flag.slice(2)] = typeof value === "string" && !value.startsWith("--") ? value.trim() : null;
        }
    }
    return args;
}
