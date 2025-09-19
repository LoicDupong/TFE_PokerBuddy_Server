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
        prize: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        gameId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'game',
                key: 'id'
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id',
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        }
    }, {
        tableName: 'game_results',
        timestamps: true,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
    });

    return GameResult;
}