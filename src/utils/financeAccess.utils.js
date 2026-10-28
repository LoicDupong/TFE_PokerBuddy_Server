// Droits sur les finances d'une partie (rebuys, add-ons, KO, récapitulatif).
// Point d'entrée unique pour toutes les routes finance et la saisie des résultats :
// l'accès administrateur (vague 2) s'ajoutera ici, sans toucher aux contrôleurs.
//
// - écriture : l'hôte de la partie uniquement ;
// - lecture : l'hôte et les joueurs de la partie (même règle que GET /games/:id).

export function getFinanceAccess(user, game, { isPlayer = false } = {}) {
    const isHost = !!user && !!game && game.hostId === user.id;
    return {
        canRead: isHost || (!!user && isPlayer),
        canWrite: isHost,
    };
}
