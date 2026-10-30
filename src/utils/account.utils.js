import { Op } from "sequelize";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import db from "../models/index.js";
import { createNotification } from "./notification.utils.js";
import { removeAvatar } from "../middlewares/upload.middleware.js";

// Suppression de compte : implémentation unique, appelée par DELETE /api/user/me
// et par la suppression d'un compte par un administrateur.
//
// Politique (détaillée dans docs/handoffs/B-auth-account.md) :
// - la ligne users est conservée et anonymisée (games.hostId est RESTRICT, et les résultats
//   des parties terminées doivent rester intacts pour les stats et classements des autres) ;
// - amitiés et notifications du compte supprimées ;
// - participations aux parties non terminées retirées, parties non terminées qu'il organise annulées ;
// - jamais de DELETE sur users (les CASCADE vers friends/notifications ne servent donc jamais).

// Nom affiché à la place du pseudo dans les lignes de joueur conservées (copie game_players.userName)
export const DELETED_PLAYER_NAME = "Deleted player";
// Domaine réservé (RFC 2606) : aucun email ne peut y être délivré, et l'inscription le refuse
export const ANONYMIZED_EMAIL_DOMAIN = "deleted.invalid";

const UNFINISHED_STATUSES = ["pending", "active"];

// Erreur métier typée : les contrôleurs la traduisent en 4xx (code stable, message en anglais)
export class AccountError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "AccountError";
        this.code = code;
    }
}

export const isReservedEmail = (email) =>
    typeof email === "string" && email.trim().toLowerCase().endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`);

/**
 * Refuse de retirer le dernier administrateur actif (non supprimé, non désactivé).
 * À appeler dans la transaction, après avoir verrouillé la ligne de l'utilisateur visé, par toute
 * opération qui fait perdre ses droits à un admin (suppression, désactivation, rétrogradation).
 * Le verrou consultatif sérialise ces opérations : deux admins qui se suppriment en même temps
 * ne peuvent pas passer tous les deux le contrôle.
 */
export async function assertNotLastActiveAdmin(user, transaction) {
    if (user.role !== "admin" || user.disabledAt || user.deletedAt) return;

    await db.sequelize.query("SELECT pg_advisory_xact_lock(hashtext('pokerbuddy:last-admin-guard'))", { transaction });
    const otherActiveAdmins = await db.User.count({
        where: { role: "admin", deletedAt: null, disabledAt: null, id: { [Op.ne]: user.id } },
        transaction,
    });
    if (otherActiveAdmins === 0) {
        throw new AccountError("LAST_ADMIN", "The last active administrator cannot be removed");
    }
}

// Pseudo neutre et unique : "_" est interdit à l'inscription, aucun vrai compte ne peut le prendre.
// Court (16 caractères) pour rester lisible dans les résultats ; l'id complet en cas de collision.
async function pickDeletedUsername(userId, transaction) {
    const short = `deleted_${userId.slice(0, 8)}`;
    const taken = await db.User.count({ where: { username: short, id: { [Op.ne]: userId } }, transaction });
    return taken ? `deleted_${userId.replace(/-/g, "")}` : short;
}

/**
 * Annulation de parties non terminées : implémentation unique, utilisée par deleteAccount (parties
 * de l'hôte supprimé) et par l'annulation d'une partie par un administrateur.
 * Dans la transaction de l'appelant : relève les comptes actifs à prévenir (invités pending/accepted
 * et hôte), supprime les notifications qui pointent vers ces parties (lien mort) puis les parties
 * (CASCADE vers game_players, game_results et game_finance_ops).
 * Les notifications game_cancelled partent après le commit, via notifyCancelledGames.
 * @param {{ id: string, name: string, hostId: string }[]} games  parties non terminées (statut vérifié par l'appelant)
 * @param {{ transaction: import("sequelize").Transaction, excludeUserId?: string|null }} options
 *   excludeUserId : compte à ne pas prévenir (l'hôte qui supprime son compte)
 * @returns {Promise<{ games: object[], recipients: { gameId: string, userId: string }[], removedNotifications: number }>}
 */
export async function cancelUnfinishedGames(games, { transaction, excludeUserId = null }) {
    if (!games.length) return { games: [], recipients: [], removedNotifications: 0 };
    const ids = games.map((g) => g.id);

    const players = await db.GamePlayer.findAll({
        where: { gameId: { [Op.in]: ids }, userId: { [Op.ne]: null }, status: { [Op.in]: ["pending", "accepted"] } },
        attributes: ["gameId", "userId"],
        transaction,
    });
    // Une seule notification par compte et par partie ; les comptes supprimés ne sont pas prévenus
    // (un compte désactivé l'est : il la verra s'il est réactivé)
    const pairs = new Map();
    for (const { gameId, userId } of [...games.map((g) => ({ gameId: g.id, userId: g.hostId })), ...players]) {
        if (userId && userId !== excludeUserId) pairs.set(`${gameId}:${userId}`, { gameId, userId });
    }
    const activeIds = pairs.size ? new Set((await db.User.findAll({
        where: { id: { [Op.in]: [...new Set([...pairs.values()].map((p) => p.userId))] }, deletedAt: null },
        attributes: ["id"],
        transaction,
    })).map((u) => u.id)) : new Set();
    const recipients = [...pairs.values()].filter((p) => activeIds.has(p.userId));

    const removedNotifications = await db.Notification.destroy({ where: { referenceId: { [Op.in]: ids } }, transaction });
    await db.Game.destroy({ where: { id: { [Op.in]: ids } }, transaction });

    return { games: games.map(({ id, name }) => ({ id, name })), recipients, removedNotifications };
}

/**
 * Après le commit : notification game_cancelled (referenceId null, la partie n'existe plus).
 * @param {{ games: { id: string, name: string }[], recipients: { gameId: string, userId: string }[] }} cancellation
 * @param {(gameName: string) => string} messageFor  phrase complète (ex. raison de l'annulation)
 * @param {"host_deleted"|"admin"} [reason]  transmis au client dans params pour traduire le texte
 */
export async function notifyCancelledGames({ games, recipients }, messageFor, reason = "host_deleted") {
    const names = new Map(games.map((g) => [g.id, g.name]));
    await Promise.all(recipients.map((r) => createNotification(r.userId, "game_cancelled", messageFor(names.get(r.gameId)), null, { gameName: names.get(r.gameId), reason })));
}

// LIKE : le pseudo est une valeur littérale, pas un motif
const escapeLike = (value) => value.replace(/[\\%_]/g, "\\$&");

async function removeStoredAvatar(avatar, userId) {
    try {
        if (avatar?.startsWith("/uploads/avatars/")) {
            // Dev : fichier local ; basename empêche de sortir du dossier
            await unlink(path.join("uploads", "avatars", path.basename(avatar)));
        } else {
            await removeAvatar(userId); // Cloudinary (sans effet si non configuré)
        }
    } catch (error) {
        if (error?.code !== "ENOENT") console.error("Avatar removal failed (non-blocking):", error);
    }
}

/**
 * Supprime (anonymise) un compte.
 * @param {string} userId
 * @param {{ actorId?: string|null }} [options]  auteur de la suppression (lui-même ou un admin), pour le journal
 * @returns {Promise<{ userId: string, actorId: string|null, cancelledGames: number, leftGames: number,
 *   removedFriendships: number, removedNotifications: number }>}  compteurs non sensibles (journal d'audit)
 * @throws {AccountError} USER_NOT_FOUND | ALREADY_DELETED | LAST_ADMIN
 */
export async function deleteAccount(userId, { actorId = null } = {}) {
    // argon2 est lent : calculé avant d'ouvrir la transaction pour la garder courte
    const unusablePassword = await argon2.hash(randomBytes(32).toString("base64url"));

    const outcome = await db.sequelize.transaction(async (transaction) => {
        const user = await db.User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!user) throw new AccountError("USER_NOT_FOUND", "User not found");
        if (user.deletedAt) throw new AccountError("ALREADY_DELETED", "This account has already been deleted");

        await assertNotLastActiveAdmin(user, transaction);

        // 1. Parties non terminées qu'il organise : annulées. Sans hôte, personne ne peut
        //    les gérer ni saisir les résultats ; les invités avec un compte sont prévenus.
        //    (annulation effectuée à l'étape 4 par cancelUnfinishedGames, partagée avec l'admin)
        const gamesToCancel = await db.Game.findAll({
            where: { hostId: user.id, status: { [Op.in]: UNFINISHED_STATUSES } },
            attributes: ["id", "name", "hostId"],
            transaction,
        });

        // 2. Ses invitations/participations aux parties non terminées des autres : retirées
        const participations = await db.GamePlayer.findAll({
            where: { userId: user.id },
            include: [{
                model: db.Game,
                as: "game",
                attributes: ["id", "name", "hostId"],
                where: { status: { [Op.in]: UNFINISHED_STATUSES }, hostId: { [Op.ne]: user.id } },
                required: true,
            }],
            attributes: ["id", "status"],
            transaction,
        });

        // Parties où il apparaît (avant suppression) et amitiés : pour retrouver les notifications qui le citent
        const playedGameIds = (await db.GamePlayer.findAll({ where: { userId: user.id }, attributes: ["gameId"], transaction }))
            .map((row) => row.gameId);
        const friendshipIds = (await db.Friend.findAll({
            where: { [Op.or]: [{ userId: user.id }, { friendId: user.id }] },
            attributes: ["id"],
            transaction,
        })).map((row) => row.id);

        // 3. Notifications : les siennes, et celles des autres qui affichent son pseudo (demandes d'ami,
        //    réponses à une invitation) ; celles des parties annulées partent avec elles (étape 4)
        const notificationConditions = [{ userId: user.id }];
        if (friendshipIds.length) {
            notificationConditions.push({ type: { [Op.in]: ["friend_request", "friend_accepted"] }, referenceId: { [Op.in]: friendshipIds } });
        }
        if (playedGameIds.length) {
            const name = escapeLike(user.username);
            notificationConditions.push({
                type: "game_invite_responded",
                referenceId: { [Op.in]: playedGameIds },
                // "<pseudo> accepted your invitation…", mais pas "<pseudo> (guest) …" (un invité homonyme)
                message: { [Op.like]: `${name} %`, [Op.notLike]: `${name} (guest)%` },
            });
        }
        const removedOwnNotifications = await db.Notification.destroy({ where: { [Op.or]: notificationConditions }, transaction });

        // 4. Suppressions (game_players et game_results des parties annulées suivent par CASCADE sur games).
        //    Un joueur qui a de l'argent engagé (buy-in, rebuy) ou un knockout dans une partie en cours
        //    reste dans la partie (anonymisé à l'étape 5) : le rejeu des opérations financières en dépend.
        const cancellation = await cancelUnfinishedGames(gamesToCancel, { transaction, excludeUserId: user.id });
        const removedNotifications = removedOwnNotifications + cancellation.removedNotifications;
        if (participations.length) {
            const ops = await db.GameFinanceOp.findAll({
                where: { gameId: { [Op.in]: [...new Set(participations.map((p) => p.game.id))] } },
                attributes: ["gamePlayerId", "eliminatorIds"],
                transaction,
            });
            const involved = new Set(ops.flatMap((op) => [op.gamePlayerId, ...(Array.isArray(op.eliminatorIds) ? op.eliminatorIds : [])]));
            const removable = participations.filter((p) => !involved.has(p.id));
            if (removable.length) {
                await db.GamePlayer.destroy({ where: { id: { [Op.in]: removable.map((p) => p.id) } }, transaction });
            }
        }
        const removedFriendships = friendshipIds.length
            ? await db.Friend.destroy({ where: { id: { [Op.in]: friendshipIds } }, transaction })
            : 0;

        // 5. Lignes conservées (parties terminées) : la copie du pseudo et un éventuel nom d'invité
        //    saisi avant l'inscription disparaissent. userId reste rattaché : le lien ne peut plus
        //    être "réclamé" par un autre compte via un ancien jeton d'invité.
        await db.GamePlayer.update(
            { userName: DELETED_PLAYER_NAME, guestName: null },
            { where: { userId: user.id }, transaction }
        );

        // 6. Anonymisation de la ligne users ; tokenVersion + 1 révoque toutes ses sessions
        const previousAvatar = user.avatar;
        await user.update({
            email: `deleted_${user.id}@${ANONYMIZED_EMAIL_DOMAIN}`,
            username: await pickDeletedUsername(user.id, transaction),
            password: unusablePassword,
            avatar: null,
            description: null,
            role: "user",
            deletedAt: new Date(),
            tokenVersion: user.tokenVersion + 1,
            passwordResetTokenHash: null,
            passwordResetExpiresAt: null,
        }, { transaction });

        return { previousAvatar, cancellation, participations, removedFriendships, removedNotifications };
    });

    // Après le commit : effets externes et notifications (non bloquants)
    await removeStoredAvatar(outcome.previousAvatar, userId);

    await notifyCancelledGames(outcome.cancellation, (name) => `"${name}" was cancelled because the host deleted their account`, "host_deleted");
    await Promise.all(outcome.participations.filter((p) => p.status === "accepted").map((p) => createNotification(
        p.game.hostId,
        "game_invite_responded",
        `A player who was coming to "${p.game.name}" deleted their account`,
        p.game.id,
        { gameName: p.game.name, reason: "player_deleted" }
    )));

    return {
        userId,
        actorId,
        cancelledGames: outcome.cancellation.games.length,
        leftGames: outcome.participations.length,
        removedFriendships: outcome.removedFriendships,
        removedNotifications: outcome.removedNotifications,
    };
}
