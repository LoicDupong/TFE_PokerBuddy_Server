import { Op } from "sequelize";
import db from "../models/index.js";
import { computePlayerStats } from "../utils/finance.utils.js";
import { findFinishedResults } from "../utils/financeStats.utils.js";

const leaderboardController = {
    getLeaderboard: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));

            // Build visible user IDs: self + accepted friends (bidirectional)
            const friendships = await db.Friend.findAll({
                where: {
                    status: "accepted",
                    [Op.or]: [
                        { userId: req.user.id },
                        { friendId: req.user.id },
                    ],
                },
                attributes: ["userId", "friendId"],
            });
            const visibleIds = new Set([req.user.id]);
            for (const f of friendships) {
                visibleIds.add(f.userId === req.user.id ? f.friendId : f.userId);
            }

            const allResults = await findFinishedResults([...visibleIds]);

            // Group by userId
            const byUser = {};
            for (const r of allResults) {
                const uid = r.player.userId;
                if (!byUser[uid]) byUser[uid] = [];
                byUser[uid].push(r);
            }

            const userIds = Object.keys(byUser);
            if (userIds.length === 0) {
                return res.status(200).json({ players: [], total: 0, page, pages: 0 });
            }

            const users = await db.User.findAll({
                where: { id: userIds },
                attributes: ["id", "username"],
            });
            const userMap = Object.fromEntries(users.map(u => [u.id, u.username]));

            // Net : prize − buy-in pour les anciennes parties, prize money + bounties − investi pour les nouvelles
            const players = userIds.map(uid => {
                const s = computePlayerStats(byUser[uid]);
                return {
                    id: uid,
                    username: userMap[uid] || "Unknown",
                    totalGames: s.totalGames,
                    wins: s.wins,
                    losses: s.losses,
                    winRate: ((s.wins / s.totalGames) * 100).toFixed(1),
                    paidPlaces: s.paidPlaces,
                    avgPlacement: parseFloat((s.rankSum / s.totalGames).toFixed(2)),
                    netResult: s.netResult,
                    netResultCents: s.netResultCents,
                    bestStreak: s.bestStreak,
                };
            });

            // Sort: net result DESC, wins DESC, avg placement ASC
            players.sort((a, b) =>
                b.netResultCents - a.netResultCents ||
                b.wins - a.wins ||
                a.avgPlacement - b.avgPlacement
            );

            const total = players.length;
            const pages = Math.ceil(total / limit);
            const paginated = players.slice((page - 1) * limit, page * limit).map((p, i) => ({
                ...p,
                rank: (page - 1) * limit + i + 1,
            }));

            return res.status(200).json({ players: paginated, total, page, pages });
        } catch (error) {
            console.error("getLeaderboard error:", error);
            return res.status(500).json({ error: "Error fetching leaderboard" });
        }
    },
};

export default leaderboardController;
