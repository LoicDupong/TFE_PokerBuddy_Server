import { DataTypes, Sequelize } from "sequelize";

/**
 * 
 * @param {Sequelize} sequelize 
 */
export default function gameModel(sequelize) {

    const Game = sequelize.define('Game', {
        id: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            autoIncrement: true,
            autoIncrementIdentity: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        dateStart: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        dateEnd: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
        buyIn: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        prizePool: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        status: {
            type: DataTypes.ENUM('pending', 'active', 'finished'),
            allowNull: false,
            defaultValue: 'pending',
        },
        placesPaid: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
        },
        bigBlind: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        smallBlind: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        hostId: {
            type: DataTypes.BIGINT,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
        },
    }, {
        timestamps: true,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        tableName: 'game'
    });

    return Game;
}