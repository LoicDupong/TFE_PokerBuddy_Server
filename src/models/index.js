import 'dotenv/config';
import { Sequelize } from "sequelize";
import userModel from "./user.model.js";
import gameModel from "./game.model.js";
import gameResultModel from "./gameResult.model.js";
import friendModel from './friend.model.js';

// Récuperation des variables d'env
const { DB_DATABASE, DB_USER, DB_PASSWORD, DB_SERVER, DB_PORT } = process.env;

console.log(DB_DATABASE, DB_USER, DB_PASSWORD, DB_SERVER, DB_PORT);


// Initialisation de l'objet "sequelize"
const sequelize = new Sequelize(DB_DATABASE, DB_USER, DB_PASSWORD, {
    host: DB_SERVER,
    port: DB_PORT,
    dialect: 'postgres'
});

// Objet DB
const db = {};
export default db;

db.sequelize = sequelize;

//* Les modèles
db.User = userModel(sequelize);
db.Game = gameModel(sequelize);
db.GameResult = gameResultModel(sequelize);
db.Friend = friendModel(sequelize);

//* Les associations
// Un utilisateur peut héberger plusieurs parties, et une partie a un seul hôte
db.User.hasMany(db.Game, { as: "hostedGames", foreignKey: "hostId" });
db.Game.belongsTo(db.User, { as: "host", foreignKey: "hostId" });

// Une partie peut avoir plusieurs résultats
db.Game.hasMany(db.GameResult, { foreignKey: 'gameId', as: 'results' });
db.GameResult.belongsTo(db.Game, { foreignKey: 'gameId', as: 'game' });

// Un utilisateur peut avoir plusieurs résultats (participations/gains)
db.User.hasMany(db.GameResult, { foreignKey: 'userId', as: 'results' });
db.GameResult.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

// Un utilisateur peut avoir plusieurs amis (relation symétrique)
db.User.belongsToMany(db.User, {
    as: 'Friends',
    through: db.Friend,
    foreignKey: 'userId',
    otherKey: 'friendId'
});

db.Friend.belongsTo(db.User, { as: 'User', foreignKey: 'userId' });
db.Friend.belongsTo(db.User, { as: 'FriendUser', foreignKey: 'friendId' });

