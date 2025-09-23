import { DataTypes, Sequelize } from "sequelize";

/**
 * 
 * @param {Sequelize} sequelize 
 */
export default function gameModel(sequelize) {
    const Game = sequelize.define(
        "Game",
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },

            // 📅 Organisation
            dateStart: {
                type: DataTypes.DATE, // heure prévue de départ (meetup)
                allowNull: false,
            },
            realStart: {
                type: DataTypes.DATE, // quand la partie commence vraiment
                allowNull: true,
            },
            dateEnd: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            location: {
                type: DataTypes.STRING,
                allowNull: false,
            },

            // 💰 Argent
            buyIn: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            prizePool: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            currency: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: "EUR", // EUR, USD, etc.
            },
            payoutDistribution: {
                type: DataTypes.JSONB,
                allowNull: true,
                defaultValue: [
                    { place: 1, percent: 70 },
                    { place: 2, percent: 30 }
                ],
            },


            // 🎮 Règles
            status: {
                type: DataTypes.ENUM("pending", "active", "finished"),
                allowNull: false,
                defaultValue: "pending",
            },
            placesPaid: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 1,
            },
            allowRebuys: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            enableBlindTimer: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            levelDuration: {
                type: DataTypes.INTEGER, // minutes par niveau
                allowNull: false,
                defaultValue: 15,
            },
            maxPlayers: {
                type: DataTypes.INTEGER,
                allowNull: true, // si null = illimité
            },

            // ♠️ Blinds
            bigBlind: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            smallBlind: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },

            // 📝 Notes
            description: {
                type: DataTypes.TEXT,
                allowNull: true,
                defaultValue: null,
            },

            // 👑 Host
            hostId: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: "users",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "RESTRICT",
            },
            inviteCode: {
                type: DataTypes.STRING,
                allowNull: true,
                unique: true,
            },
        },
        {
            timestamps: true,
            createdAt: "createdAt",
            updatedAt: "updatedAt",
            tableName: "games",
        }
    );

    return Game;
}
