# M3-03 — Liste, recherche et filtres PNJs

## Expérience livrée

La route `#/pnjs` affiche une liste sémantique de cartes compactes, sans reprendre le graphe D3 du
bureau. Chaque carte réserve une zone stable de portrait, montre le nom, le groupe ou lieu principal,
le statut public utile et ouvre la fiche avec une cible tactile d’au moins 44 px.

Le tri est déterministe : `ordre` numérique présent, puis nom normalisé sans accent, puis identifiant.
Le nombre de résultats est toujours visible. Les états « aucun PNJ publié » et « aucun résultat pour
ces critères » sont distincts ; le second permet d’effacer immédiatement les critères.

## Recherche et filtres

La recherche est insensible à la casse, aux diacritiques et aux variantes d’apostrophe. Avec le schéma
public actuellement versionné, elle couvre le nom, le statut/état de vie, le lieu et le groupe. Le
modèle accepte aussi les champs publics `surnom`, `role`/`rôle`, `profession` et `groupes` si une future
évolution du normaliseur les ajoute explicitement ; aucun champ Firestore inconnu n’est lu directement
par la vue.

La saisie est temporisée de 100 ms afin d’éviter un rendu inutile à chaque frappe ; vider le champ
restaure la liste immédiatement. Recherche et filtres restent dans la préférence locale bornée M3-02,
jamais dans l’URL.

La feuille basse propose uniquement les valeurs réellement présentes parmi les PNJs visibles :
groupe, statut et lieu. Plusieurs valeurs d’une même dimension sont combinées en union ; les dimensions
sont combinées entre elles. Le bouton indique le nombre de choix actifs. Les changements restent dans
un brouillon jusqu’à **Appliquer**, et **Tout effacer** vide ce brouillon. Une valeur disparue après une
mise à jour temps réel est retirée automatiquement de la préférence.

La feuille piège le focus, se ferme avec Échap, son bouton de fermeture ou le fond, restaure le focus
au déclencheur et verrouille réellement le défilement de la page arrière.

## Portraits et confidentialité

Un portrait moderne est chargé uniquement si son descripteur désigne exactement
`portraits/{pnjId}/{fichier}`. La vue utilise le service public M2 et reçoit uniquement une URL objet
`blob:` temporaire. Elle ne place jamais de chemin, URL signée, blob ou contenu de document dans
`localStorage`, le DOM textuel ou les journaux.

Les références legacy, externes, invalides ou appartenant à un autre propriétaire restent en
placeholder. Une panne Storage ou un lancement hors ligne ne transforme pas la carte en erreur. Les
URLs objet sont référencées par poignée et libérées au changement de rendu, au démontage et avant la
fermeture du client Firebase. Un chargement ancien ne peut ni remplacer ni effacer un portrait plus
récent.

## Cycle de vie

La vue possède un seul abonnement au store. Une mise à jour de métadonnées cache/serveur modifie les
indicateurs sans reconstruire les cartes ni recharger les portraits. Une modification de contenu
remplace la liste par fragment en conservant `scrollTop`. Recherche, filtres et position de liste sont
donc retrouvés au retour d’une fiche.

Au démontage, le timer de recherche, l’abonnement store, les écouteurs, la feuille basse et toutes les
poignées d’image sont libérés. Les callbacks de portrait arrivant après le démontage restent sans effet.

## Validation locale

Les suites M3-03 couvrent :

- recherche accents/casse/apostrophes, tri, facettes, combinaisons et réconciliation ;
- volumes 0, 1, 50 et 501 PNJs et sorties immuables ;
- focus/Échap/backdrop/scroll-lock et trois cycles de feuille basse ;
- chemins portrait hostiles, panne, course A→B et libération exacte des URLs objet ;
- abonnement de vue, temporisation, scroll, metadata seule et trois montages/démontages.

La recette visuelle et tactile Android 320–430 px, paysage, deux thèmes et lecteur d’écran reste à
effectuer sur appareil. La recette iOS demeure différée.
