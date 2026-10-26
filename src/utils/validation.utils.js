import db from "../models/index.js";

// Mêmes règles que le formulaire d'inscription du client (schemas/authSchema.js) :
// le serveur ne doit pas dépendre de la validation côté navigateur.

export const normalizeEmail = (email) => (typeof email === "string" ? email.trim().toLowerCase() : "");

export function validateEmail(email) {
    if (!email) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Invalid email address";
    return null;
}

export function validateUsername(username) {
    if (typeof username !== "string" || username.length < 3) return "Username must be at least 3 characters";
    if (username.length > 15) return "Username must be less than 15 characters";
    if (!/^[a-zA-Z0-9]+$/.test(username)) return "Username can only contain letters and numbers (no spaces or special characters)";
    return null;
}

export function validatePassword(password) {
    if (typeof password !== "string" || password.length < 6) return "Password must be at least 6 characters";
    if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
    if (!/[0-9]/.test(password)) return "Password must contain at least one number";
    return null;
}

// Comparaison insensible à la casse : "Loic" et "loic" sont le même compte
const lowerEquals = (column, value) =>
    db.sequelize.where(db.sequelize.fn("lower", db.sequelize.col(column)), value.toLowerCase());

export const findUserByEmail = (email) => db.User.findOne({ where: lowerEquals("email", email) });

export const findUserByUsername = (username) => db.User.findOne({ where: lowerEquals("username", username) });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value);
