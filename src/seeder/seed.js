import db from "../models/index.js";
import usersJSON from './users.json' with { type: 'json' };
import gamesJSON from './games.json' with { type: 'json' };
import gamesResultsJSON from './gamesResults.json' with { type: 'json' };
import friendsJSON from './friends.json' with { type: 'json' };
import argon2 from "argon2";

try {
    await db.sequelize.authenticate();
    console.log('Connection has been established successfully.');

    await db.sequelize.sync({ force: true });
    console.log("✅ All models were synchronized successfully.");

    await seederInsert();

} catch (error) {
    console.error('Unable to connect to the database:', error);
}

async function seederInsert() {
    const t = await db.sequelize.transaction();

    try {
        // --- Users ---
        const rowsUsers = await Promise.all(usersJSON.map(async u => ({
            email: u.email,
            password: await argon2.hash(u.password),
            username: u.username,
            avatar: u.avatar ?? null,
            description: u.description ?? null,
        })));

        const createdUsers = await db.User.bulkCreate(rowsUsers, {
            updateOnDuplicate: ["email", "password", "username", "avatar", "description"],
            transaction: t,
            returning: true,
        });

        const userMap = {};
        createdUsers.forEach(u => {
            userMap[u.username] = u.id;
        });

        // --- Friends ---
        for (const f of friendsJSON) {
            const userId = userMap[f.user];
            const friendId = userMap[f.friend];
            if (userId && friendId) {
                await db.Friend.findOrCreate({
                    where: { userId, friendId },
                    defaults: { status: f.status },
                    transaction: t,
                });
            }
        }

        // --- Games ---
        const rowsGames = gamesJSON.map(g => ({
            name: g.name,
            dateStart: g.dateStart,
            dateEnd: g.dateEnd,
            location: g.location,
            buyIn: g.buyIn,
            prizePool: g.prizePool,
            status: g.status,
            placesPaid: g.placesPaid,
            description: g.description,
            bigBlind: g.bigBlind,
            smallBlind: g.smallBlind,
            hostId: userMap[g.host],
        }));

        const createdGames = await db.Game.bulkCreate(rowsGames, {
            updateOnDuplicate: [
                "name", "dateStart", "dateEnd", "location",
                "buyIn", "prizePool", "status", "placesPaid",
                "description", "bigBlind", "smallBlind", "hostId"
            ],
            transaction: t,
            returning: true,
        });

        const gameMap = {};
        createdGames.forEach(g => {
            gameMap[g.name] = g.id;
        });

        // --- GamePlayers + Results ---
        const gamePlayerMap = {};

        for (const gr of gamesResultsJSON) {
            const gameId = gameMap[gr.game];
            const userId = userMap[gr.user];

            if (gameId && userId) {
                // Si ce joueur n'existe pas déjà dans GamePlayer → on l'insère
                if (!gamePlayerMap[`${gr.game}_${gr.user}`]) {
                    const gp = await db.GamePlayer.create({
                        gameId,
                        userId,
                        userName: gr.user,
                        isConfirmed: true,
                    }, { transaction: t });

                    gamePlayerMap[`${gr.game}_${gr.user}`] = gp.id;
                }

                // Ensuite, on crée le GameResult pour ce joueur
                await db.GameResult.create({
                    rank: gr.rank,
                    prize: gr.prize,
                    gameId,
                    gamePlayerId: gamePlayerMap[`${gr.game}_${gr.user}`],
                }, { transaction: t });
            }
        }

        await t.commit();
        console.log("✅ Seed data inserted successfully.");
    } catch (error) {
        await t.rollback();
        console.error("❌ Seed failed:", error);
    }
}
