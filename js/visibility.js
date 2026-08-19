// Compatibilité M1-01 : l'ancien format n'avait pas de drapeau, mais toute autre valeur
// atypique doit rester masquée côté visiteur jusqu'à décision du MJ.
export function visiblePourJoueurs(data) {
    return data?.visibleJoueurs === true || !Object.hasOwn(data ?? {}, 'visibleJoueurs');
}
