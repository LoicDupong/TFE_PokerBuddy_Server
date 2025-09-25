import { DataTypes, Sequelize } from "sequelize";

/**
 * 
 * @param {Sequelize} sequelize 
 */
export default function gamePlayersModel(sequelize) {
    const GamePlayer = sequelize.define('GamePlayer', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        gameId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'games',
                key: 'id',
            },
            onDelete: 'CASCADE',
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id',
            },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
        userName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        guestName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM("pending", "accepted", "refused"),
            defaultValue: "pending",
        },
    }, {
        tableName: 'game_players',
        timestamps: true,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
    });

    return GamePlayer;
}
