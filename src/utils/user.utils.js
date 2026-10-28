// Champs d'un compte renvoyés à son propriétaire : jamais le hash du mot de passe,
// la version de session ni le jeton de réinitialisation
const SELF_ATTRIBUTES = ["id", "username", "email", "avatar", "description", "role", "createdAt"];

export function toSafeUser(user) {
    const plain = typeof user?.get === "function" ? user.get({ plain: true }) : user;
    return Object.fromEntries(SELF_ATTRIBUTES.filter((key) => key in plain).map((key) => [key, plain[key]]));
}
