import { DataTypes, Sequelize } from "sequelize";

/**
 *
 * @param {Sequelize} sequelize
 */
export default function userModel(sequelize) {

    const User = sequelize.define('User', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        email: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            validate: { isEmail: true },
        },
        password: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        username: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        avatar: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
        },

        // Rôle applicatif (back-office) : sans lien avec l'hôte ou les joueurs d'une partie
        role: {
            type: DataTypes.ENUM("user", "admin"),
            allowNull: false,
            defaultValue: "user",
        },
        // Version de session : l'incrémenter invalide tous les JWT déjà émis (claim "tv")
        tokenVersion: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        // Compte désactivé par un administrateur : connexion et API refusées
        disabledAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
        // Compte supprimé (anonymisé) : la ligne reste pour les résultats des parties partagées
        deletedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
        // Langue préférée (emails et notifications) : "en" | "fr"
        locale: {
            type: DataTypes.STRING(5),
            allowNull: false,
            defaultValue: "en",
        },
        // Mot de passe oublié : seul le hash du jeton est stocké, jamais le jeton lui-même
        passwordResetTokenHash: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        passwordResetExpiresAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
    }, {
        tableName: 'users',
        timestamps: true,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
    });

return User;

}
