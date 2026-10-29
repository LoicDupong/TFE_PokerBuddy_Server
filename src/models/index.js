import { Sequelize } from "sequelize";
import userModel from "./user.model.js";
import gameModel from "./game.model.js";
import gameResultModel from "./gameResult.model.js";
import friendModel from './friend.model.js';
import gamePlayersModel from './gamePlayers.model.js';
import notificationModel from './notification.model.js';
import gameFinanceOpModel from './gameFinanceOp.model.js';
import adminAuditLogModel from './adminAuditLog.model.js';

// Récupération des variables d'env
// Chargées par les scripts npm (--env-file), jamais implicitement :
// sinon le dev retombe sur la DATABASE_URL de prod du fichier .env
const { DATABASE_URL, DB_SSL } = process.env;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is missing: add it to the env file used by your npm script (.env.local in dev)");
}

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  // Le SQL loggé contient des données personnelles (emails, contenu des requêtes) : dev uniquement
  logging: process.env.NODE_ENV === 'dev' ? console.log : false,
  // DB_SSL=false pour une base Postgres locale (Docker) sans SSL
  dialectOptions: DB_SSL === 'false' ? {} : {
    ssl: {
      require: true,
      rejectUnauthorized: false, // ⚠️ obligatoire pour Neon
    },
  },
});

const db = {};
export default db;

db.sequelize = sequelize;

//* Les modèles
db.User = userModel(sequelize);
db.Game = gameModel(sequelize);
db.GameResult = gameResultModel(sequelize);
db.Friend = friendModel(sequelize);
db.GamePlayer = gamePlayersModel(sequelize);
db.Notification = notificationModel(sequelize);
db.GameFinanceOp = gameFinanceOpModel(sequelize);
db.AdminAuditLog = adminAuditLogModel(sequelize);

// ───────────────────────────────
// USER <-> GAME (Host)
// ───────────────────────────────
db.User.hasMany(db.Game, { as: "hostedGames", foreignKey: "hostId" });
db.Game.belongsTo(db.User, { as: "host", foreignKey: "hostId" });

// ───────────────────────────────
// FRIENDSHIP (User <-> User via Friend)
// ───────────────────────────────
db.User.belongsToMany(db.User, {
  as: "Friends",
  through: db.Friend,
  foreignKey: "userId",
  otherKey: "friendId",
});

db.User.belongsToMany(db.User, {
  as: "FriendOf",
  through: db.Friend,
  foreignKey: "friendId",
  otherKey: "userId",
});

db.Friend.belongsTo(db.User, { as: "User", foreignKey: "userId" });
db.Friend.belongsTo(db.User, { as: "FriendUser", foreignKey: "friendId" });

// ───────────────────────────────
// GAME <-> GAMEPLAYERS
// ───────────────────────────────
db.Game.hasMany(db.GamePlayer, { foreignKey: "gameId", as: "playerLinks" });
db.GamePlayer.belongsTo(db.Game, { foreignKey: "gameId", as: "game" });

// ───────────────────────────────
// USER <-> GAMEPLAYERS (si compte lié)
// ───────────────────────────────
db.User.hasMany(db.GamePlayer, { foreignKey: "userId", as: "gamePlayerLinks" });
db.GamePlayer.belongsTo(db.User, { foreignKey: "userId", as: "user" });

// ───────────────────────────────
// GAMEPLAYERS <-> GAMERESULT
// ───────────────────────────────
db.GamePlayer.hasOne(db.GameResult, { foreignKey: "gamePlayerId", as: "result" });
db.GameResult.belongsTo(db.GamePlayer, { foreignKey: "gamePlayerId", as: "player" });

// ───────────────────────────────
// GAME <-> GAMERESULT (accès direct)
// ───────────────────────────────
db.Game.hasMany(db.GameResult, { foreignKey: "gameId", as: "results" });
db.GameResult.belongsTo(db.Game, { foreignKey: "gameId", as: "game" });

// L’accès au user se fait via: GameResult → GamePlayer → User

// ───────────────────────────────
// GAME <-> OPÉRATIONS FINANCIÈRES (rebuys, add-ons, KO)
// ───────────────────────────────
// Contraintes explicites : l'association ne doit pas remplacer celles déclarées dans le modèle
db.Game.hasMany(db.GameFinanceOp, { foreignKey: "gameId", as: "financeOps", onDelete: "CASCADE", onUpdate: "CASCADE" });
db.GameFinanceOp.belongsTo(db.Game, { foreignKey: "gameId", as: "game", onDelete: "CASCADE", onUpdate: "CASCADE" });

// USER <-> NOTIFICATION
db.User.hasMany(db.Notification, { foreignKey: "userId", as: "notifications" });
db.Notification.belongsTo(db.User, { foreignKey: "userId", as: "user" });

// USER <-> JOURNAL D'AUDIT ADMIN (auteur de l'action)
db.AdminAuditLog.belongsTo(db.User, { foreignKey: "actorId", as: "actor", onDelete: "CASCADE", onUpdate: "CASCADE" });

