import jwt from 'jsonwebtoken';

export function generateToken({ id, username, tokenVersion }) {

    // Ecriture sous forme de promesse
    return new Promise((resolve, reject) => {

        //? Donnée du token ; tv = version de session, comparée à users.tokenVersion à chaque requête
        const data = { id, username, tv: tokenVersion ?? 0 };

        //? Clef secret pour la signature du token
        const secretKey = process.env.JWT_SECRET

        //? La configuration du token
        const option = {
            algorithm: 'HS512',
            // 7 jours, renouvelé à chaque ouverture de l'app via /auth/me (une soirée poker dépasse souvent 3 h)
            expiresIn: '7d', // vercel/ms
            issuer: process.env.JWT_ISSUER,
            audience: process.env.JWT_AUDIENCE
        };

        //? Générer le token
        jwt.sign(data, secretKey, option, (error, token) => {

            if(error) {
                reject(new Error('Token not generated'));
                return;
            }

            resolve(token);
        });

    });
}

export function decodeToken(token) {

    // Ecriture sous forme de promesse 
    return new Promise((resolve, reject) => {

        //? Clef secret pour la signature du token
        const secretKey = process.env.JWT_SECRET 

        //? Option de validation
        const options = {
            issuer: process.env.JWT_ISSUER,
            audience: process.env.JWT_AUDIENCE
        }

        jwt.verify(token, secretKey, options, (error, data) => {
            if(error) {
                reject(error);
                return;
            }

            resolve(data);
        });
    });
}

// Jeton d'invité (réponse sans compte). Audience distincte : il ne peut jamais servir de session
const guestAudience = () => `${process.env.JWT_AUDIENCE}:guest`;

export function generateGuestToken({ gamePlayerId, gameId }) {
    return jwt.sign({ type: "guest", gamePlayerId, gameId }, process.env.JWT_SECRET, {
        algorithm: 'HS512',
        expiresIn: '60d',
        issuer: process.env.JWT_ISSUER,
        audience: guestAudience(),
    });
}

// Renvoie le contenu du jeton invité, ou null s'il est invalide/expiré
export function verifyGuestToken(token) {
    if (typeof token !== "string" || !token) return null;
    try {
        const data = jwt.verify(token, process.env.JWT_SECRET, {
            issuer: process.env.JWT_ISSUER,
            audience: guestAudience(),
        });
        return data.type === "guest" ? data : null;
    } catch {
        return null;
    }
}
