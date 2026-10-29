import db from "../models/index.js";

// Journal d'audit du back-office (table admin_audit_logs). Contrat stable, réutilisable
// par d'autres modules admin (support, analytics) : appeler logAdminAction dans la même
// transaction que l'écriture qu'il trace, pour qu'une action annulée ne laisse pas de trace fausse.

// Clés jamais journalisées, même si un appelant les passe par erreur dans details
const SENSITIVE_KEY = /password|token|secret|hash/i;
const MAX_STRING_LENGTH = 500;

/**
 * Copie de details sans données sensibles : clés interdites retirées (à toute profondeur),
 * chaînes tronquées, valeurs non sérialisables ignorées.
 */
export function sanitizeAuditDetails(details) {
    if (details === null || details === undefined) return null;
    if (typeof details === "string") return details.slice(0, MAX_STRING_LENGTH);
    if (typeof details === "number" || typeof details === "boolean") return details;
    if (details instanceof Date) return details.toISOString();
    if (Array.isArray(details)) return details.map(sanitizeAuditDetails);
    if (typeof details === "object") {
        return Object.fromEntries(Object.entries(details)
            .filter(([key, value]) => !SENSITIVE_KEY.test(key) && value !== undefined && typeof value !== "function")
            .map(([key, value]) => [key, sanitizeAuditDetails(value)]));
    }
    return null;
}

/**
 * Écrit une ligne d'audit.
 * @param {{ actorId: string, action: string, targetType: string, targetId?: string|null, details?: object|null }} entry
 * @param {{ transaction?: import("sequelize").Transaction }} [options]
 */
export async function logAdminAction({ actorId, action, targetType, targetId = null, details = null }, { transaction } = {}) {
    return db.AdminAuditLog.create({
        actorId,
        action,
        targetType,
        targetId: targetId === null || targetId === undefined ? null : String(targetId),
        details: sanitizeAuditDetails(details),
    }, { transaction });
}
