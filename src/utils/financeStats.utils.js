// Statistiques de joueur (profil public, "me", leaderboard) à partir des résultats des parties terminées.
// Net : prize − buy-in pour les anciennes parties (inchangé) ; prize money + bounties − total investi
// (buy-in, rebuys, add-ons) pour celles suivies par le Game Manager (investedCents renseigné).
import { Op } from "sequelize";
import db from "../models/index.js";
import { computePlayerStats } from "./finance.utils.js";

// Colonnes de game_results nécessaires au calcul du net (anciennes et nouvelles parties)
export const STATS_RESULT_ATTRIBUTES = ["rank", "prize", "prizeCents", "bountyCents", "investedCents"];

// Résultats des parties terminées des joueurs donnés, du plus ancien au plus récent
export function findFinishedResults(userIds) {
    return db.GameResult.findAll({
        include: [
            {
                model: db.GamePlayer,
                as: "player",
                where: { userId: { [Op.in]: userIds } },
                attributes: ["userId"],
            },
            {
                model: db.Game,
                as: "game",
                where: { status: "finished" },
                attributes: ["buyIn", "placesPaid", "dateEnd"],
            },
        ],
        attributes: STATS_RESULT_ATTRIBUTES,
        order: [[{ model: db.Game, as: "game" }, "dateEnd", "ASC"]],
    });
}

// Bloc "stats" du profil (GET /user/:id et /user/me), mêmes champs et formats qu'avant
// (+ netResultCents, valeur exacte en centimes)
export async function getPlayerStats(userId) {
    const results = await findFinishedResults([userId]);
    const s = computePlayerStats(results);
    const gamesHosted = await db.Game.count({ where: { hostId: userId } });

    return {
        totalGames: s.totalGames,
        wins: s.wins,
        losses: s.losses,
        winRate: s.totalGames > 0 ? ((s.wins / s.totalGames) * 100).toFixed(1) : "0.0",
        paidPlaces: s.paidPlaces,
        avgPlacement: s.totalGames > 0 ? (s.rankSum / s.totalGames).toFixed(2) : null,
        netResult: s.netResult,
        netResultCents: s.netResultCents,
        bestStreak: s.bestStreak,
        gamesHosted,
    };
}
