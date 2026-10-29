import { DataTypes, Sequelize } from "sequelize";

/**
 * 
 * @param {Sequelize} sequelize 
 */
export default function gameResultModel(sequelize) {
    const GameResult = sequelize.define('GameResult', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        rank: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        // Unités entières (historique) : toujours rempli, arrondi de prizeCents pour les nouvelles parties
        prize: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        // Parties suivies par les opérations financières (null pour les anciennes) :
        // prize money, bounties reçues (KO + bounty finale) et total investi, en centimes.
        // Les stats utilisent investedCents ≠ null pour savoir quelle formule appliquer.
        prizeCents: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
        },
        bountyCents: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
        },
        investedCents: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
        },
        gameId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'games',
                key: 'id',
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
        gamePlayerId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'game_players',
                key: 'id',
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
    }, {
        tableName: 'game_results',
        indexes: [
            {
                unique: true,
                fields: ['gameId', 'gamePlayerId'] // ✅ contrainte anti-doublon
            }
        ],
        timestamps: true,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
    });

    return GameResult;
}
