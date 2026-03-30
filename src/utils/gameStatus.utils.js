
export async function updateGameStatus(game) {
    const now = Date.now();
    const startTime = new Date(game.realStart ?? game.dateStart).getTime();

    if (game.status === 'pending' && startTime <= now) {
        await game.update({ status: 'active' });
    } else if (game.status === "active" && now >= startTime + 24 * 60 * 60 * 1000) {
        await game.update({ status: 'finished', dateEnd: new Date() });
    }

    return game;
}