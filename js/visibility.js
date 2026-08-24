// Compatibilité M1-01 : l'ancien format n'avait pas de drapeau, mais toute autre valeur
// atypique ou suppression en cours doit rester masquée côté visiteur.
export function visiblePourJoueurs(data) {
    return data?.suppressionEnCours !== true
        && (data?.visibleJoueurs === true || !Object.hasOwn(data ?? {}, 'visibleJoueurs'));
}
