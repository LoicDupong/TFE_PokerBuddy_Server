import 'dotenv/config';
import { Sequelize } from "sequelize";
import userModel from "./user.model.js";
import gameModel from "./game.model.js";
import gameResultModel from "./gameResult.model.js";
import friendModel from './friend.model.js';
import gamePlayersModel from './gamePlayers.model.js';

// Récupération des variables d'env
const { DATABASE_URL } = process.env;

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
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

