import { DataTypes, Sequelize } from 'sequelize';

/**
 * @param {Sequelize} sequelize
 */
export default function friendModel(sequelize) {

    const Friend = sequelize.define('Friend', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
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
        },
        friendId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id',
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
        status: {
            type: DataTypes.ENUM('pending', 'accepted', 'declined'),
            allowNull: false,
            defaultValue: 'pending',
        },
    }, {
        tableName: 'friends',
        timestamps: true,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            {
                unique: true,
                fields: ['userId', 'friendId']
            }
        ]
    });
    return Friend;
}   

