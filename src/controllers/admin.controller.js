import { Op } from "sequelize";
import db from "../models/index.js";
import { generateToken } from "../utils/jwt.utils.js";
import { isUuid } from "../utils/validation.utils.js";
import { logAdminAction } from "../utils/adminAudit.utils.js";
import {
    AccountError, assertNotLastActiveAdmin, cancelUnfinishedGames, deleteAccount, notifyCancelledGames,
} from "../utils/account.utils.js";
import { buildFinanceView, loadFinanceContext, playerName } from "../utils/financeData.utils.js";
import {
    GAME_STATUSES, USER_ROLES, USER_STATUSES, cleanReason, escapeLike, paginated, parsePagination, userStatus, validateReason,
} from "../utils/admin.utils.js";

// Back-office : toutes ces routes passent par requireAdmin() (routers/admin.route.js), le rôle
// étant relu en base à chaque requête. Chaque écriture est tracée par logAdminAction dans sa transaction.

// Champs d'un compte visibles par un admin : jamais password, tokenVersion ni jeton de reset
const ADMIN_USER_ATTRIBUTES = ["id", "username", "email", "avatar", "role", "createdAt", "disabledAt", "deletedAt"];
const ADMIN_GAME_ATTRIBUTES = [
    "id", "name", "status", "dateStart", "dateEnd", "location", "buyIn", "prizePool", "currency",
    "allowRebuys", "pkoEnabled", "hostId", "createdAt",
];

const toAdminUser = (user) => {
    const plain = typeof user.get === "function" ? user.get({ plain: true }) : user;
    const safe = Object.fromEntries(ADMIN_USER_ATTRIBUTES.filter((key) => key in plain).map((key) => [key, plain[key]]));
    return { ...safe, status: userStatus(plain) };
};

// Erreurs métier → 4xx avec code stable ; le reste → 500 générique (détail en console seulement)
function sendError(res, error, label) {
    if (error instanceof AccountError) {
        const status = error.code.endsWith("_NOT_FOUND") ? 404 : 400;
        return res.status(status).json({ error: error.message, code: error.code });
    }
    console.error(`admin ${label} error:`, error);
    return res.status(500).json({ error: "Internal server error" });
}

const refuseSelf = (req, res, message) => {
    if (req.params.id !== req.user.id) return false;
    res.status(400).json({ error: message, code: "SELF_ACTION" });
    return true;
};

/**
 * Écriture sur un compte : ligne verrouillée (FOR UPDATE), compte supprimé refusé, puis mutate(user, transaction)
 * qui renvoie { changed, ... } et écrit l'audit si changed.
 */
async function updateTargetUser(req, mutate) {
    return db.sequelize.transaction(async (transaction) => {
        const user = await db.User.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!user) throw new AccountError("USER_NOT_FOUND", "User not found");
        if (user.deletedAt) throw new AccountError("ALREADY_DELETED", "This account has been deleted");
        return { user, ...(await mutate(user, transaction)) };
    });
}

const audit = (req, action, targetType, targetId, details, transaction) =>
    logAdminAction({ actorId: req.user.id, action, targetType, targetId, details }, { transaction });

const adminController = {
    // GET /admin/users?q=&role=&status=&page=&pageSize=
    listUsers: async (req, res) => {
        try {
            const pagination = parsePagination(req.query);
            const { role, status } = req.query;
            if (role && !USER_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role", code: "INVALID_ROLE" });
            if (status && !USER_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status", code: "INVALID_STATUS" });

            const where = {};
            if (pagination.q) {
                const pattern = `%${escapeLike(pagination.q)}%`;
                where[Op.or] = [{ username: { [Op.iLike]: pattern } }, { email: { [Op.iLike]: pattern } }];
            }
            if (role) where.role = role;
            if (status === "active") Object.assign(where, { deletedAt: null, disabledAt: null });
            if (status === "disabled") Object.assign(where, { deletedAt: null, disabledAt: { [Op.ne]: null } });
            if (status === "deleted") where.deletedAt = { [Op.ne]: null };

            const { rows, count } = await db.User.findAndCountAll({
                where,
                attributes: ADMIN_USER_ATTRIBUTES,
                order: [["createdAt", "DESC"], ["id", "ASC"]],
                limit: pagination.limit,
                offset: pagination.offset,
            });
            res.status(200).json(paginated(rows.map(toAdminUser), count, pagination));
        } catch (error) {
            sendError(res, error, "listUsers");
        }
    },

    // GET /admin/users/:id : profil sûr + compteurs
    getUser: async (req, res) => {
        try {
            const user = await db.User.findByPk(req.params.id, { attributes: [...ADMIN_USER_ATTRIBUTES, "description"] });
            if (!user) return res.status(404).json({ error: "User not found", code: "USER_NOT_FOUND" });

            const [gamesHosted, gamesPlayed, friends, lastDisable] = await Promise.all([
                db.Game.count({ where: { hostId: user.id } }),
                // Parties jouées = lignes de joueur avec un résultat saisi
                db.GamePlayer.count({
                    where: { userId: user.id },
                    include: [{ model: db.GameResult, as: "result", attributes: [], required: true }],
                }),
                db.Friend.count({ where: { status: "accepted", [Op.or]: [{ userId: user.id }, { friendId: user.id }] } }),
                user.disabledAt ? db.AdminAuditLog.findOne({
                    where: { action: "user.disable", targetType: "user", targetId: user.id },
                    order: [["createdAt", "DESC"]],
                    attributes: ["details"],
                }) : null,
            ]);

            res.status(200).json({
                user: {
                    ...toAdminUser(user),
                    description: user.description,
                    disabledReason: lastDisable?.details?.reason ?? null,
                    counts: { gamesHosted, gamesPlayed, friends },
                },
            });
        } catch (error) {
            sendError(res, error, "getUser");
        }
    },

    // PATCH /admin/users/:id/role { role } : rétrogradation = garde dernier admin + sessions révoquées
    updateRole: async (req, res) => {
        try {
            const role = req.body?.role;
            if (!USER_ROLES.includes(role)) return res.status(400).json({ error: "Role must be user or admin", code: "INVALID_ROLE" });

            const { user, changed } = await updateTargetUser(req, async (user, transaction) => {
                if (user.role === role) return { changed: false };
                const previousRole = user.role;
                if (role === "user") await assertNotLastActiveAdmin(user, transaction);
                // Un admin rétrogradé perd ses sessions : rien ne doit survivre de ses droits
                await user.update({ role, tokenVersion: role === "user" ? user.tokenVersion + 1 : user.tokenVersion }, { transaction });
                await audit(req, "user.role", "user", user.id, { previousRole, role }, transaction);
                return { changed: true };
            });
            res.status(200).json({ user: toAdminUser(user), changed });
        } catch (error) {
            sendError(res, error, "updateRole");
        }
    },

    // POST /admin/users/:id/disable { reason? }
    disableUser: async (req, res) => {
        try {
            if (refuseSelf(req, res, "You cannot disable your own account")) return;
            const reasonError = validateReason(req.body?.reason);
            if (reasonError) return res.status(400).json({ error: reasonError, code: "INVALID_REASON" });

            const { user, changed } = await updateTargetUser(req, async (user, transaction) => {
                if (user.disabledAt) return { changed: false };
                await assertNotLastActiveAdmin(user, transaction);
                // tokenVersion + 1 : toutes ses sessions tombent ; un éventuel lien de reset devient inutile
                await user.update({
                    disabledAt: new Date(),
                    tokenVersion: user.tokenVersion + 1,
                    passwordResetTokenHash: null,
                    passwordResetExpiresAt: null,
                }, { transaction });
                await audit(req, "user.disable", "user", user.id, { reason: cleanReason(req.body?.reason) }, transaction);
                return { changed: true };
            });
            res.status(200).json({ user: toAdminUser(user), changed });
        } catch (error) {
            sendError(res, error, "disableUser");
        }
    },

    // POST /admin/users/:id/enable : les anciennes sessions restent invalides (tokenVersion déjà incrémenté)
    enableUser: async (req, res) => {
        try {
            const { user, changed } = await updateTargetUser(req, async (user, transaction) => {
                if (!user.disabledAt) return { changed: false };
                await user.update({ disabledAt: null }, { transaction });
                await audit(req, "user.enable", "user", user.id, null, transaction);
                return { changed: true };
            });
            res.status(200).json({ user: toAdminUser(user), changed });
        } catch (error) {
            sendError(res, error, "enableUser");
        }
    },

    // POST /admin/users/:id/revoke-sessions : sur soi-même, un nouveau token garde la session courante
    revokeSessions: async (req, res) => {
        try {
            const { user } = await updateTargetUser(req, async (user, transaction) => {
                await user.update({ tokenVersion: user.tokenVersion + 1 }, { transaction });
                await audit(req, "user.revoke_sessions", "user", user.id, null, transaction);
                return { changed: true };
            });
            const body = { user: toAdminUser(user), changed: true };
            if (user.id === req.user.id) body.token = await generateToken(user);
            res.status(200).json(body);
        } catch (error) {
            sendError(res, error, "revokeSessions");
        }
    },

    // DELETE /admin/users/:id : uniquement via deleteAccount (même politique que la suppression par l'utilisateur)
    deleteUser: async (req, res) => {
        try {
            if (refuseSelf(req, res, "Delete your own account from your account settings")) return;

            const { userId, actorId, ...counts } = await deleteAccount(req.params.id, { actorId: req.user.id });
            // deleteAccount ouvre sa propre transaction : l'audit est écrit juste après son commit
            try {
                await audit(req, "user.delete", "user", userId, counts);
            } catch (error) {
                console.error(`admin deleteUser: audit write failed for user ${userId} (deleted by ${actorId}):`, error);
            }
            res.status(200).json({ message: "Account deleted", ...counts });
        } catch (error) {
            sendError(res, error, "deleteUser");
        }
    },

    // GET /admin/games?q=&status=&page=&pageSize=
    listGames: async (req, res) => {
        try {
            const pagination = parsePagination(req.query);
            const { status } = req.query;
            if (status && !GAME_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status", code: "INVALID_STATUS" });

            const where = {};
            if (pagination.q) where.name = { [Op.iLike]: `%${escapeLike(pagination.q)}%` };
            if (status) where.status = status;

            const { rows, count } = await db.Game.findAndCountAll({
                where,
                attributes: [
                    ...ADMIN_GAME_ATTRIBUTES,
                    [db.sequelize.literal(`(SELECT COUNT(*) FROM game_players gp WHERE gp."gameId" = "Game"."id")::int`), "playersCount"],
                ],
                include: [{ model: db.User, as: "host", attributes: ["id", "username"] }],
                order: [["dateStart", "DESC"], ["id", "ASC"]],
                limit: pagination.limit,
                offset: pagination.offset,
            });
            res.status(200).json(paginated(rows.map((g) => g.get({ plain: true })), count, pagination));
        } catch (error) {
            sendError(res, error, "listGames");
        }
    },

    // GET /admin/games/:id : joueurs, résultats et résumé des finances (vue calculée par les utils de C)
    getGame: async (req, res) => {
        try {
            const ctx = await loadFinanceContext(req.params.id);
            if (!ctx) return res.status(404).json({ error: "Game not found", code: "GAME_NOT_FOUND" });

            const host = await db.User.findByPk(ctx.game.hostId, { attributes: ["id", "username", "disabledAt", "deletedAt"] });
            let finance = null;
            try {
                const view = buildFinanceView(ctx);
                finance = { tracked: view.tracked, locked: view.locked, currency: view.currency, totals: view.totals, issues: view.issues.length };
            } catch (error) {
                // Historique incohérent : le détail de la partie reste consultable
                console.error("admin getGame: finance view failed:", error);
            }

            const game = Object.fromEntries(ADMIN_GAME_ATTRIBUTES.map((key) => [key, ctx.game[key]]));
            res.status(200).json({
                game: {
                    ...game,
                    host: host ? { id: host.id, username: host.username, status: userStatus(host) } : null,
                    players: ctx.gamePlayers.map((gp) => ({
                        id: gp.id, userId: gp.userId ?? null, name: playerName(gp), status: gp.status, isGuest: !gp.userId,
                    })),
                    results: ctx.results
                        .map((r) => ({
                            gamePlayerId: r.gamePlayerId, rank: r.rank, prize: r.prize,
                            prizeCents: r.prizeCents ?? null, bountyCents: r.bountyCents ?? null,
                        }))
                        .sort((a, b) => a.rank - b.rank),
                    finance,
                },
            });
        } catch (error) {
            sendError(res, error, "getGame");
        }
    },

    // POST /admin/games/:id/cancel { reason? } : même effet que l'annulation d'un hôte supprimé
    // (suppression + game_cancelled). Une partie terminée ne se supprime jamais (stats, classements).
    cancelGame: async (req, res) => {
        try {
            const reasonError = validateReason(req.body?.reason);
            if (reasonError) return res.status(400).json({ error: reasonError, code: "INVALID_REASON" });

            const cancellation = await db.sequelize.transaction(async (transaction) => {
                const game = await db.Game.findByPk(req.params.id, {
                    attributes: ["id", "name", "hostId", "status"],
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });
                if (!game) throw new AccountError("GAME_NOT_FOUND", "Game not found");
                if (game.status === "finished") {
                    throw new AccountError("GAME_FINISHED", "A finished game cannot be cancelled");
                }
                const result = await cancelUnfinishedGames([game], { transaction });
                await audit(req, "game.cancel", "game", game.id, {
                    name: game.name, status: game.status, hostId: game.hostId,
                    notified: result.recipients.length, reason: cleanReason(req.body?.reason),
                }, transaction);
                return result;
            });

            await notifyCancelledGames(cancellation, (name) => `"${name}" was cancelled by an administrator`, "admin");
            res.status(200).json({ message: "Game cancelled", notified: cancellation.recipients.length });
        } catch (error) {
            sendError(res, error, "cancelGame");
        }
    },

    // GET /admin/audit-logs?actorId=&targetType=&targetId=&action=&page=&pageSize=
    listAuditLogs: async (req, res) => {
        try {
            const pagination = parsePagination(req.query);
            const { actorId, targetType, targetId, action } = req.query;
            if (actorId && !isUuid(actorId)) return res.status(400).json({ error: "Invalid actorId", code: "INVALID_FILTER" });

            const where = {};
            if (actorId) where.actorId = actorId;
            for (const [key, value] of Object.entries({ targetType, targetId, action })) {
                if (typeof value === "string" && value) where[key] = value.slice(0, 100);
            }

            const { rows, count } = await db.AdminAuditLog.findAndCountAll({
                where,
                include: [{ model: db.User, as: "actor", attributes: ["id", "username"] }],
                order: [["createdAt", "DESC"], ["id", "ASC"]],
                limit: pagination.limit,
                offset: pagination.offset,
            });
            res.status(200).json(paginated(rows.map((r) => r.get({ plain: true })), count, pagination));
        } catch (error) {
            sendError(res, error, "listAuditLogs");
        }
    },
};

export default adminController;
