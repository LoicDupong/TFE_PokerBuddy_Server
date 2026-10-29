import { DataTypes, Sequelize } from "sequelize";

/**
 * Pages vues agrégées par jour (analytics sans cookie) : jamais d'IP ni d'identifiant de visiteur.
 * @param {Sequelize} sequelize
 */
export default function pageViewDailyModel(sequelize) {
    return sequelize.define("PageViewDaily", {
        day: { type: DataTypes.DATEONLY, allowNull: false, primaryKey: true },
        path: { type: DataTypes.STRING(200), allowNull: false, primaryKey: true },
        referrerHost: { type: DataTypes.STRING(100), allowNull: false, defaultValue: "", primaryKey: true },
        views: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    }, {
        tableName: "page_views_daily",
        timestamps: false,
    });
}
