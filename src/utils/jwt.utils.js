import jwt from 'jsonwebtoken';

export function generateToken({ id, username }) {

    // Ecriture sous forme de promesse
    return new Promise((resolve, reject) => {

        //? Donnée du token
        const data = { id, username };

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