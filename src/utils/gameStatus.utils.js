
export async function updateGameStatus(game) {
    const now = Date.now();
    const startTime = new Date(game.realStart ?? game.dateStart).getTime();

    if (game.status === 'pending' && startTime <= now) {
        await game.update({ status: 'active' });
    } else if (game.status === 'active' && startTime > now) {
        // dateStart was moved to the future after the game was marked active
        await game.update({ status: 'pending' });
    }
    // Pas de passage automatique à "finished" : seule la saisie des résultats termine une partie,
    // sinon l'hôte ne peut plus les encoder (le rappel de notification reste actif jusque-là)

    return game;
}