
export async function updateGameStatus(game) {
    const now = Date.now();
    const startTime = new Date(game.startTime).getTime();

    if(game.status === 'pending' && startTime <= now) {
        await game.update({ status: 'active' });
    }

    if(game.status === "active" && now >= startTime + 24 * 60 * 60 * 1000) {
        await game.update({ status: 'finished' });
    }

    return game;
}