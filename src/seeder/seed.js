import db from "../models/index.js";
import usersJSON from './users.json' with { type: 'json' };
import gamesJSON from './games.json' with { type: 'json' };
import gamesResultsJSON from './gamesResults.json' with { type: 'json' };

try {
    // Test de la connexion
    await db.sequelize.authenticate();
    console.log('Connection has been established successfully.');

    // Synchronisation des modèles avec la base de données
    await db.sequelize.sync({ force: true });
    console.log("✅ All models were synchronized successfully.");

    // await seederInsert();

}
catch (error) {
    console.error('Unable to connect to the database:', error);
}

async function seederInsert() {
    // --- Users ---
    const rowsUsers = usersJSON.map(u => ({
        email: u.email,
        password: u.password,
        username: u.username,
        avatar: u.avatar ?? null,
        description: u.description ?? null,
    }));

    await db.User.bulkCreate(rowsUsers, {
        updateOnDuplicate: ['email', 'password', 'username', 'avatar', 'description']
    });

    // Liaison Game / User (host et winner)
    for (const g of gamesJSON) {
        const gameInstance = await db.Game.findByPk(g.id);
        if (!gameInstance) continue;

        const hostInstance = await db.User.findOne(
            { where: { username: g.host } }
        );

        // Set host
        if (hostInstance) {
            await gameInstance.setHost(hostInstance);
        }
    }

    // --- Games ---
    const rowsGames = gamesJSON.map(g => ({
        name: g.name,
        dateStart: g.dateStart,
        dateEnd: g.dateEnd,
        buyIn: g.buyIn,
        prizePool: g.prizePool,
        status: g.status,
        placesPaid: g.placesPaid,
        description: g.description,
        bigBlind: g.bigBlind,
        smallBlind: g.smallBlind,
        hostId: g.hostId,
    }));

    await db.Game.bulkCreate(rowsGames, {
        updateOnDuplicate: ['name', 'dateStart', 'dateEnd', 'buyIn', 'prizePool', 'status', 'placesPaid', 'description', 'bigBlind', 'smallBlind', 'hostId']
    });

    // Liaison GameResult / User + Game
    for (const gr of gamesResultsJSON) {
        const gameInstance = await db.Game.findByPk(gr.gameId);
        if (!gameInstance) continue;

        const userInstance = await db.User.findByPk(gr.userId);
        if (!userInstance) continue;

        const gameResultInstance = await db.GameResult.findOne(
            { where: { gameId: gr.gameId, userId: gr.userId } }
        );

    }


    // --- GamesResults ---
    const rowsResults = gamesResultsJSON.map((gr) => ({
        rank: gr.rank,
        prize: gr.prize,
        gameId: gr.gameId,
        userId: gr.userId,
    }));

    await db.GameResult.bulkCreate(rowsResults, {
        updateOnDuplicate: ["rank", "prize", "gameId", "userId"],
    });


    console.log("✅ Seed data inserted successfully.");
}
