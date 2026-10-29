import { DataTypes, Sequelize } from "sequelize";

/**
 * Opération financière d'une partie (événement) : buy-in, rebuy, add-on ou knockout PKO.
 * Rien n'est jamais supprimé : une annulation renseigne voidedAt, une correction annule l'opération
 * et en crée une nouvelle au même rang (seq). Bounties et totaux sont recalculés en rejouant
 * les opérations (utils/finance.utils.js).
 *
 * @param {Sequelize} sequelize
 */
export default function gameFinanceOpModel(sequelize) {
    const GameFinanceOp = sequelize.define("GameFinanceOp", {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        gameId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: "games", key: "id" },
            // Partie supprimée → son historique financier avec elle (comme game_players)
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        // Clé d'idempotence générée par le client : un double clic ou un renvoi réseau ne crée pas de doublon
        // (unicité par index nommé plus bas : `unique: true` est recréé en double à chaque sync({ alter }))
        opId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        // Ordre de rejeu dans la partie ; une correction reprend le seq de l'opération corrigée
        seq: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        type: {
            type: DataTypes.ENUM("buyin", "rebuy", "addon", "knockout"),
            allowNull: false,
        },
        // Joueur qui paie (entrée) ou joueur éliminé (knockout)
        gamePlayerId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: "game_players", key: "id" },
            // NO ACTION (vérifié en fin d'instruction) : la suppression d'une partie passe (cascade),
            // mais on ne peut pas retirer seul un joueur qui a de l'argent engagé
            onDelete: "NO ACTION",
            onUpdate: "CASCADE",
        },
        // Entrées uniquement : montant payé, en centimes
        amountCents: {
            type: DataTypes.INTEGER,
            allowNull: true,
            validate: { min: 0 },
        },
        // Entrées : jetons reçus (informatif, sert au tapis moyen)
        chips: {
            type: DataTypes.INTEGER,
            allowNull: true,
            validate: { min: 0 },
        },
        // Knockouts uniquement : id(s) game_players du/des éliminateur(s), dans l'ordre choisi par l'hôte
        eliminatorIds: {
            type: DataTypes.JSONB,
            allowNull: true,
        },
        // Opération remplacée par celle-ci (correction)
        correctsId: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        voidedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        // Qui a enregistré / annulé (l'hôte aujourd'hui, un admin plus tard)
        createdById: {
            type: DataTypes.UUID,
            allowNull: true,
            references: { model: "users", key: "id" },
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
        },
        voidedById: {
            type: DataTypes.UUID,
            allowNull: true,
            references: { model: "users", key: "id" },
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
        },
    }, {
        tableName: "game_finance_ops",
        timestamps: true,
        createdAt: "createdAt",
        updatedAt: "updatedAt",
        // Mêmes noms que la migration 0200 : sync({ alter }) les reconnaît et ne les duplique pas
        indexes: [
            { name: "game_finance_ops_op_id_unique", unique: true, fields: ["opId"] },
            { name: "game_finance_ops_game_id_seq", fields: ["gameId", "seq"] },
            { name: "game_finance_ops_game_player_id", fields: ["gamePlayerId"] },
        ],
    });

    return GameFinanceOp;
}
