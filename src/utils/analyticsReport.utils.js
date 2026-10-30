import { QueryTypes } from "sequelize";
import db from "../models/index.js";
import { isoDay } from "./analytics.utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const select = (sql, replacements) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const num = (value) => Number(value ?? 0);

/**
 * Métriques produit d'une période (jours UTC), calculées depuis les tables existantes.
 * `range` vient de parseRange() : { from, to, fromDate, toExclusive, days }.
 * Tout est agrégé : aucune donnée personnelle dans le résultat.
 */
export async function buildOverview(range) {
    const r = { from: range.fromDate, to: range.toExclusive };
    const days = { fromDay: range.from, toDay: range.to };
    const inRange = (column) => `${column} >= :from AND ${column} < :to`;
    const dayOf = (column) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

    const [
        [signups], [games], [active], [players], [invites], [finance], [support], [views],
        signupsByDay, gamesByDay, viewsByDay, topPages, topReferrers,
    ] = await Promise.all([
        select(`SELECT count(*)::int AS n FROM users WHERE ${inRange('"createdAt"')}`, r),
        select(`SELECT count(*) FILTER (WHERE ${inRange('"createdAt"')})::int AS created,
                       count(*) FILTER (WHERE status = 'finished' AND ${inRange('"dateStart"')})::int AS finished
                FROM games`, r),
        // Actif = a organisé ou accepté de jouer une partie dont la date de départ tombe dans la période
        select(`SELECT count(DISTINCT uid)::int AS n FROM (
                    SELECT g."hostId" AS uid FROM games g WHERE ${inRange('g."dateStart"')}
                    UNION
                    SELECT gp."userId" FROM game_players gp JOIN games g ON g.id = gp."gameId"
                    WHERE gp.status = 'accepted' AND gp."userId" IS NOT NULL AND ${inRange('g."dateStart"')}
                ) t`, r),
        select(`SELECT COALESCE(AVG(c), 0)::float AS avg FROM (
                    SELECT count(gp.id) AS c FROM games g
                    LEFT JOIN game_players gp ON gp."gameId" = g.id AND gp.status = 'accepted'
                    WHERE ${inRange('g."dateStart"')} GROUP BY g.id
                ) t`, r),
        // Invitations de la période, hors ligne de l'hôte lui-même
        select(`SELECT count(*)::int AS sent,
                       count(*) FILTER (WHERE gp.status = 'accepted')::int AS accepted,
                       count(*) FILTER (WHERE gp.status = 'refused')::int AS refused,
                       count(*) FILTER (WHERE gp.status = 'pending')::int AS pending
                FROM game_players gp JOIN games g ON g.id = gp."gameId"
                WHERE ${inRange('gp."createdAt"')} AND gp."userId" IS DISTINCT FROM g."hostId"`, r),
        // Argent engagé = entrées (buy-in, rebuys, add-ons) non annulées enregistrées dans la période
        select(`SELECT COALESCE(sum("amountCents"), 0)::bigint AS volume, count(*)::int AS ops
                FROM game_finance_ops
                WHERE type IN ('buyin', 'rebuy', 'addon') AND "voidedAt" IS NULL AND ${inRange('"createdAt"')}`, r),
        select(`SELECT count(*) FILTER (WHERE ${inRange('"createdAt"')})::int AS created,
                       count(*) FILTER (WHERE status <> 'resolved')::int AS open
                FROM support_tickets`, r),
        select(`SELECT COALESCE(sum(views), 0)::bigint AS n FROM page_views_daily WHERE day >= :fromDay AND day <= :toDay`, days),
        select(`SELECT ${dayOf('"createdAt"')} AS day, count(*)::int AS n FROM users WHERE ${inRange('"createdAt"')} GROUP BY 1`, r),
        select(`SELECT ${dayOf('"createdAt"')} AS day, count(*)::int AS n FROM games WHERE ${inRange('"createdAt"')} GROUP BY 1`, r),
        select(`SELECT day::text AS day, sum(views)::bigint AS n FROM page_views_daily
                WHERE day >= :fromDay AND day <= :toDay GROUP BY 1`, days),
        select(`SELECT path, sum(views)::bigint AS views FROM page_views_daily
                WHERE day >= :fromDay AND day <= :toDay GROUP BY path ORDER BY views DESC, path LIMIT 10`, days),
        select(`SELECT "referrerHost" AS host, sum(views)::bigint AS views FROM page_views_daily
                WHERE day >= :fromDay AND day <= :toDay AND "referrerHost" <> '' GROUP BY 1 ORDER BY views DESC, host LIMIT 10`, days),
    ]);

    const byDay = (rows) => new Map(rows.map((row) => [row.day, num(row.n)]));
    const s = byDay(signupsByDay);
    const g = byDay(gamesByDay);
    const v = byDay(viewsByDay);
    const daily = [];
    for (let i = 0; i < range.days; i++) {
        const day = isoDay(new Date(range.fromDate.getTime() + i * DAY_MS));
        daily.push({ day, signups: s.get(day) ?? 0, gamesCreated: g.get(day) ?? 0, pageViews: v.get(day) ?? 0 });
    }

    // Taux d'acceptation = acceptées / (acceptées + refusées), en % : une invitation sans réponse ne compte pas contre
    const answered = invites.accepted + invites.refused;
    return {
        range: { from: range.from, to: range.to, days: range.days },
        totals: {
            signups: signups.n,
            activeUsers: active.n,
            gamesCreated: games.created,
            gamesFinished: games.finished,
            avgPlayersPerGame: Math.round(players.avg * 10) / 10,
            invitations: { ...invites, acceptanceRate: answered ? Math.round((invites.accepted / answered) * 1000) / 10 : null },
            financeVolumeCents: num(finance.volume),
            financeOps: finance.ops,
            supportTicketsCreated: support.created,
            supportTicketsOpen: support.open,
            pageViews: num(views.n),
        },
        daily,
        topPages: topPages.map((row) => ({ path: row.path, views: num(row.views) })),
        topReferrers: topReferrers.map((row) => ({ host: row.host, views: num(row.views) })),
    };
}
