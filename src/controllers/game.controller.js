import db from "../models/index.js";

const gameController = {
    createGame: async (req, res) => {
        try {
            const { name, type, maxPlayers } = req.body;
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const newGame = await db.Game.create({
                name,
                dateStart: new Date(),
                dateEnd: null,
                buyIn,
                prizePool,
                status: 'pending',
                placesPaid,
                description,
                bigBlind,
                smallBlind,
                hostId: req.user.id,
            });
            res.status(201).json({ game: newGame });
        } catch (error) {
            res.status(500).json({ error: "Error creating game" });
        }
    },

    getGames: async (req, res) => {
        try {
            if (!req.user) return res.status(401).json({ error: "Unauthorized" });

            const games = await db.Game.findAll({
                include: [
                    {
                        model: db.GameResult,
                        as: "results",
                        where: { userId: req.user.id }, // filtre sur l’utilisateur connecté
                        required: true, // INNER JOIN (sinon ça ramène aussi les games sans ce user)
                        include: [
                            {
                                model: db.User,
                                as: "user",
                                attributes: ["id", "username", "email"], // infos du joueur
                            },
                        ],
                    },
                    {
                        model: db.User,
                        as: "host",
                        attributes: ["id", "username", "email"], // infos du host
                    },
                ],
            });

            res.status(200).json({ games });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Error fetching games" });
        }
    }
};

export default gameController;
