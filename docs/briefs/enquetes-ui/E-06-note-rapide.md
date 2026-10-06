# E-06 — Note rapide (bureau et mobile)

> Lire d'abord [`README.md`](README.md), la colonne droite de `maquettes/01-bureau-dossier` et
> `maquettes/06-mobile-note-rapide`. Cas d'usage : noter un nom pendant la séance en deux gestes.

| | |
|---|---|
| Objectif | Saisir une note privée liée au contexte courant sans ouvrir l'éditeur complet |
| Fichiers | `js/enquetes-workspace.js` (ou nouveau `js/enquetes-quick-note.js`), `css/enquetes-workspace.css`, `sw.js` si nouveau fichier, tests |
| Dépend de | E-05 |

## Règle de fond

La note rapide **réutilise le circuit d'enregistrement des notes existant** : même
`client.save({ type:'notes', zone:'user:<uid>', … })`, même brouillon local
(`client.saveDraft` / `readDraft` / `removeDraft`, clé = identifiant de la note), même lien créé
par `addLink(noteId, cibleId, 'user:<uid>')`. Ne pas écrire un second chemin de sauvegarde : si
nécessaire, extraire de `openEditor` une fonction `saveNote({ id, body, links })` utilisée par les
deux. Titre de la note : vide (le `recordTitle` existant affiche le début du texte).

## À faire

1. **Bureau — colonne carnet** (`<aside>` d'E-02) :
   - en tête : cadenas (SVG), « Mon carnet » en capitales or, mention « privé » ;
   - zone de saisie (`<textarea>` 3 lignes, libellé `visually-hidden` « Note rapide sur ce
     dossier », placeholder « Une idée, un nom entendu… »), sous-ligne « Reliée à ce dossier »
     (ou « à cette pièce ») et bouton « Noter ». Ctrl/⌘+Entrée enregistre. Après succès : champ
     vidé, note apparue en tête de liste, message `role="status"` « Notée ».
     Brouillon : chaque frappe appelle `saveDraft` (comme l'auto-sauvegarde actuelle des notes) ;
     au retour sur le même contexte, le texte non envoyé est restauré ;
   - liste des notes liées (`linkedNotes`) : titre, texte (`textView`, 4 lignes max puis
     « Lire la suite »), sous-ligne « Pièce n° 1 · il y a 2 jours » si l'information de date
     existe déjà dans l'enregistrement, sinon sans date (ne pas ajouter de champ) ; clic = ouvrir
     la note ;
   - **suggestion** : jusqu'à 3 notes non classées (`isUnclassified`) en dessous, avec le lien
     « Relier à ce dossier » (`addLink`) ;
   - pied : la phrase de confidentialité existante, en petit.
2. **Mobile — bouton flottant** : pastille or 56 px (icône plume, `aria-label` « Note rapide »)
   en bas à droite au-dessus de la navigation basse (`bottom: calc(var(--m-nav-height) + 16px +
   var(--m-safe-bottom))`), sur la liste (variante large avec libellé « Note rapide »), le dossier
   et la pièce. Masqué quand un éditeur est ouvert (le masquer à l'ouverture du clavier n'est pas
   demandé).
3. **Mobile — feuille basse** : `<dialog>` modal ancré en bas (coins 18 px, poignée décorative),
   titre « Note rapide · mon carnet » avec cadenas, bouton « Fermer » (le brouillon reste),
   `<textarea>` qui prend la hauteur disponible (police 18 px), section « RELIER À » : puces
   bascule (`aria-pressed`) pré-cochées sur le contexte (dossier courant ; sur une pièce : la pièce
   **et** son dossier de contexte), plus les PNJ du dossier et « Autre… » (ouvre le sélecteur de
   lien existant). Pied : statut « Brouillon gardé sur ce téléphone » (`role="status"`) et bouton
   principal « Noter ». Sur la liste (sans contexte), aucune puce pré-cochée : la note sera « non
   classée ». Focus dans le champ à l'ouverture, rendu au bouton flottant à la fermeture.
4. **Hors connexion** : « Noter » enregistre le brouillon local et affiche « Hors connexion :
   note gardée sur cet appareil, envoi à la reconnexion » — en s'appuyant sur le mécanisme de
   reprise des brouillons existant (« Reprendre le brouillon »), sans file d'attente nouvelle.
5. Session `ancien` / maintenance : la note rapide reste disponible (le carnet personnel l'est
   déjà). Session non connectée : bouton flottant masqué.

## Tests

Enregistrement via le circuit commun (un seul appel `save` de type `notes`, zone `user:`), liens
créés pour chaque puce cochée, brouillon restauré après remontage, échec réseau → brouillon
conservé et message, aucun lien quand aucune puce n'est cochée, focus rendu à la fermeture.

## Recette

- [ ] Bureau : noter depuis un dossier puis une pièce ; la note apparaît dans le carnet et dans
      l'onglet « Mes notes » du mobile.
- [ ] Mobile : bouton flottant → noter → la feuille se ferme, la note est liée.
- [ ] Mode avion : note gardée, envoyée après reconnexion via « Reprendre le brouillon ».
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(enquetes): quick private note from desktop sidebar and mobile sheet`
