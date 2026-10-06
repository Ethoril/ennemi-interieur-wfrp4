const chains = new WeakMap();

/**
 * Envoie le brouillon du contrôleur, un envoi à la fois (les appels se mettent en file) ; un envoi déjà parti (réponse
 * incertaine) est rejoué à l'identique, puis ce qui a été modifié entre-temps est envoyé à son tour (3 passes au plus).
 * Résultat du dernier envoi, `undefined` s'il n'y avait plus rien à envoyer ; peut lever l'erreur du serveur.
 * ponytail: après `awaiting-snapshot` on s'arrête ; une modification faite pendant l'attente part à l'envoi suivant (retour en ligne).
 */
export function submitDraft(controller) {
    const run = async () => {
        let result;
        for (let pass = 0; pass < 3 && controller.getState().hasDraft; pass += 1) {
            result = await controller.submitPatch();
            if (result?.status === 'retry-required') result = await controller.retryPendingPatch();
            if (result?.status !== 'saved') break;
        }
        return result;
    };
    const next = (chains.get(controller) ?? Promise.resolve()).then(run, run);
    chains.set(controller, next.catch(() => {}));
    return next;
}
