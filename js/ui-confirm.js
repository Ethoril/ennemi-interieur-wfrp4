// Modale de confirmation unique pour les actions destructives du site.
// Construite sur <dialog> : le voile modal, le piège de focus et la fermeture
// par Échap sont fournis par le navigateur, inutile de les réimplémenter.
// Un seul élément est créé puis réutilisé (ensureDialog), et les écouteurs
// sont retirés à chaque fermeture pour ne pas s'empiler d'un appel à l'autre.

let _dialog = null;

function ensureDialog() {
    if (_dialog) return _dialog;
    _dialog = document.createElement('dialog');
    _dialog.className = 'ui-confirm';
    _dialog.innerHTML = `
        <h3 class="ui-confirm-titre"></h3>
        <p  class="ui-confirm-message"></p>
        <div class="ui-confirm-actions">
            <button class="ui-confirm-annuler" type="button">Annuler</button>
            <button class="ui-confirm-valider" type="button"></button>
        </div>`;
    document.body.appendChild(_dialog);
    return _dialog;
}

/**
 * Demande une confirmation. Renvoie une promesse résolue à true si l'action
 * est confirmée, false sinon (bouton Annuler, Échap, clic sur le voile).
 *
 * titre et message passent par textContent : ils peuvent contenir un nom de
 * personnage ou de joueur, aucun échappement HTML n'est donc requis.
 */
export function confirmAction({ titre, message, libelleAction = 'Confirmer', danger = false }) {
    const d = ensureDialog();
    d.querySelector('.ui-confirm-titre').textContent   = titre;
    d.querySelector('.ui-confirm-message').textContent = message;
    const valider = d.querySelector('.ui-confirm-valider');
    valider.textContent = libelleAction;
    valider.classList.toggle('ui-confirm-danger', danger);
    d.classList.toggle('ui-confirm--danger', danger);

    const annuler = d.querySelector('.ui-confirm-annuler');

    return new Promise(resolve => {
        const fin = (reponse) => {
            valider.removeEventListener('click', ok);
            annuler.removeEventListener('click', nonMerci);
            d.removeEventListener('close', annule);
            d.removeEventListener('click', voile);
            d.close();
            resolve(reponse);
        };
        const ok       = () => fin(true);
        const nonMerci = () => fin(false);
        const annule   = () => fin(false);
        const voile    = (e) => { if (e.target === d) fin(false); };

        valider.addEventListener('click', ok);
        annuler.addEventListener('click', nonMerci);   // le bouton Annuler doit fermer
        d.addEventListener('close', annule);           // couvre Échap
        d.addEventListener('click', voile);            // clic sur le voile
        d.showModal();
        annuler.focus();                               // défaut non destructif
    });
}
