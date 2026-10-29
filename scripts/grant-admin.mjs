// Promotion d'un compte au rôle admin (premier administrateur, ou secours si plus aucun admin).
// Dev  : npm run admin:grant -- --username <pseudo> --email <email> [--dry-run]
// Prod : npm run admin:grant:prod -- --username <pseudo> --email <email> [--dry-run]
// Rien n'est codé en dur : le pseudo ET l'email doivent désigner le même compte actif, puis tout
// se fait par id. Idempotent : un compte déjà admin ne change pas (code de sortie 0).
// Une ligne d'audit est écrite (actorId = le compte promu, details.via = "script").
import db from "../src/models/index.js";
import { findUserByEmail, findUserByUsername, normalizeEmail } from "../src/utils/validation.utils.js";
import { decideGrant, parseGrantArgs } from "../src/utils/admin.utils.js";
import { logAdminAction } from "../src/utils/adminAudit.utils.js";

const USAGE = "Usage: npm run admin:grant -- --username <username> --email <email> [--dry-run]";

// Les messages ne contiennent jamais l'email (les sorties de Render sont conservées)
async function main() {
    const { username, email, dryRun } = parseGrantArgs(process.argv.slice(2));
    if (!username || !email) {
        console.error(USAGE);
        return 1;
    }

    const [byUsername, byEmail] = await Promise.all([findUserByUsername(username), findUserByEmail(normalizeEmail(email))]);
    const decision = decideGrant(byUsername, byEmail);

    switch (decision.action) {
        case "not_found":
        case "mismatch":
            // Même message : le script ne révèle pas lequel des deux existe
            console.error("❌ No account matches both this username and this email. Nothing changed.");
            return 1;
        case "inactive":
            console.error(`❌ Account ${decision.userId} is deleted or disabled. Nothing changed.`);
            return 1;
        case "already_admin":
            console.log(`✅ ${byUsername.username} (${decision.userId}) is already an admin. Nothing changed.`);
            return 0;
    }

    if (dryRun) {
        console.log(`🔎 Dry run: ${byUsername.username} (${decision.userId}) would be granted the admin role.`);
        return 0;
    }

    // Par id, ligne verrouillée : l'état est revérifié au cas où il aurait changé depuis la recherche
    const granted = await db.sequelize.transaction(async (transaction) => {
        const user = await db.User.findByPk(decision.userId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!user || user.deletedAt || user.disabledAt) return null;
        if (user.role === "admin") return user;
        const previousRole = user.role;
        await user.update({ role: "admin" }, { transaction });
        await logAdminAction({
            actorId: user.id,
            action: "user.role",
            targetType: "user",
            targetId: user.id,
            details: { via: "script", previousRole, role: "admin" },
        }, { transaction });
        return user;
    });

    if (!granted) {
        console.error("❌ The account changed during the operation. Nothing changed.");
        return 1;
    }
    console.log(`✅ ${granted.username} (${granted.id}) is now an admin.`);
    return 0;
}

try {
    process.exitCode = await main();
} catch (error) {
    console.error("❌ grant-admin failed:", error.message);
    process.exitCode = 1;
} finally {
    await db.sequelize.close();
}
