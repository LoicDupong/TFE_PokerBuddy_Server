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
            // Rebuys et add-ons autorisés (enregistrés dans game_finance_ops)
            allowRebuys: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            // Prix d'un rebuy en centimes ; null = même montant que le buy-in
            rebuyAmountCents: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: null,
                validate: { min: 0 },
            },

            // 🎯 PKO (Progressive Knockout) : désactivé = partie classique, aucun impact
            pkoEnabled: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            // Part de chaque entrée (buy-in, rebuy, add-on) qui va dans la bounty du joueur ; le reste au prize pool
            pkoBountyPercent: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 50,
                validate: { min: 0, max: 100 },
            },
            // Part de la bounty éliminée versée tout de suite à l'éliminateur ; le reste s'ajoute à sa bounty
            pkoCashPercent: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 50,
                validate: { min: 0, max: 100 },
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
