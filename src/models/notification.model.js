import { DataTypes, Sequelize } from 'sequelize';

/**
 * @param {Sequelize} sequelize
 */
export default function notificationModel(sequelize) {
    const Notification = sequelize.define('Notification', {
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
        type: {
            type: DataTypes.ENUM(
                'friend_request',
                'friend_accepted',
                'game_invite',
                'game_invite_responded',
                'game_result'
            ),
            allowNull: false,
        },
        message: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        read: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        referenceId: {
            type: DataTypes.UUID,
            allowNull: true,
        },
    }, {
        tableName: 'notifications',
        timestamps: true,
        updatedAt: false,
    });

    return Notification;
}
