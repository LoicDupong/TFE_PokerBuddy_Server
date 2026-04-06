import { Op } from "sequelize";
import db from "../models/index.js";

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

            const allResults = await db.GameResult.findAll({
                include: [
                    {
                        model: db.GamePlayer,
                        as: "player",
                        where: { userId: { [Op.in]: [...visibleIds] } },
                        attributes: ["userId"],
                    },
                    {
                        model: db.Game,
                        as: "game",
                        where: { status: "finished" },
                        attributes: ["buyIn", "placesPaid", "dateEnd"],
                    },
                ],
                attributes: ["rank", "prize"],
                order: [[{ model: db.Game, as: "game" }, "dateEnd", "ASC"]],
            });

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

            const players = userIds.map(uid => {
                const results = byUser[uid];
                const totalGames = results.length;
                const wins = results.filter(r => r.rank === 1).length;
                const losses = totalGames - wins;
                const winRate = ((wins / totalGames) * 100).toFixed(1);
                const paidPlaces = results.filter(r => r.rank <= r.game.placesPaid).length;
                const avgPlacement = parseFloat((results.reduce((s, r) => s + r.rank, 0) / totalGames).toFixed(2));
                const netResult = results.reduce((s, r) => s + (r.prize - r.game.buyIn), 0);

                let bestStreak = 0, cur = 0;
                for (const r of results) {
                    if (r.rank === 1) { cur++; bestStreak = Math.max(bestStreak, cur); }
                    else { cur = 0; }
                }

                return { id: uid, username: userMap[uid] || "Unknown", totalGames, wins, losses, winRate, paidPlaces, avgPlacement, netResult, bestStreak };
            });

            // Sort: net result DESC, wins DESC, avg placement ASC
            players.sort((a, b) =>
                b.netResult - a.netResult ||
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
