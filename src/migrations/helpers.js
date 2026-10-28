// Outils pour des migrations idempotentes : en dev, sync({ alter: true }) a souvent déjà créé
// les colonnes et tables décrites par les modèles, la migration ne doit alors rien casser.

export async function tableExists(queryInterface, table, transaction) {
    const [rows] = await queryInterface.sequelize.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :table",
        { replacements: { table }, transaction }
    );
    return rows.length > 0;
}

export async function addColumnIfMissing(queryInterface, table, column, spec, transaction) {
    const columns = await queryInterface.describeTable(table, { transaction });
    if (columns[column]) return false;
    await queryInterface.addColumn(table, column, spec, { transaction });
    return true;
}

export async function createTableIfMissing(queryInterface, table, attributes, transaction) {
    if (await tableExists(queryInterface, table, transaction)) return false;
    await queryInterface.createTable(table, attributes, { transaction });
    return true;
}

// ALTER TYPE … ADD VALUE IF NOT EXISTS (Postgres 12+) pour étendre un ENUM existant,
// ex. addEnumValue(qi, "enum_notifications_type", "support_reply")
export async function addEnumValue(queryInterface, enumName, value, transaction) {
    await queryInterface.sequelize.query(
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value.replace(/'/g, "''")}'`,
        { transaction }
    );
}
