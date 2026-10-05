# P0.1–P0.2 — Cartographie des écritures de fiche et contrats

État observé dans le dépôt local le 4 octobre 2026. Cette note couvre la fiche bureau de `js/fiche.js` et `js/fiche-cloud.js`. Elle ne modifie aucune fiche ni aucun service. Les parcours PNJ, enquêtes et images relèvent des autres chantiers P0/J2.

## Résultat de l’audit

La fiche n’a aujourd’hui qu’un chemin de sauvegarde applicatif, mais ce chemin transporte l’intégralité de `exportData()` : `save()` temporise, `saveNow()` écrit un miroir `localStorage` marqué `_dirty`, puis `cloudSave(data)` envoie `{ data, updatedAt }` par `setDoc(fiches/{charId})`. Le cloud n’a ni révision, ni fusion, ni identité d’opération. Une écriture remplace donc toute la fiche. Si une écriture est en vol, `fiche-cloud.js` ne conserve que le dernier instantané en attente.

La frontière `cloudSave` seule ne suffit pas à faire un protocole sûr. Plusieurs actions mutent `state` directement, certaines passent ensuite par `recalc()` (qui appelle `save()`), d’autres appellent `save()` sans `recalc()`, et l’import/reset remplacent l’état entier. Le contrat doit être branché sur les intentions métier avant leur réduction en instantané.

## Chemins d’écriture recensés

| Famille | Entrées et mutation actuelle | Persistance / caractère sensible |
| --- | --- | --- |
| Champs d’identité et caractéristiques | Nom, race, carrière, rang, blessures actuelles, résilience, détermination, chance, destin, corruption, possessions ; caractéristiques de base et avances. La plupart des champs texte appellent `save()` sur `input`; race et caractéristiques appellent `recalc()`. | Brouillon dès la saisie ; chaque sauvegarde mène au remplacement complet cloud. Une avance de caractéristique saisie à la main ne crée pas de ligne XP. Avances réservées au MJ dans le modèle cible. |
| Compétences de base | Avances par ligne ; spécialité de compétence de base modifiable. Avances → `recalc()`, spécialité → `save()`. | Les avances sont sensibles (MJ uniquement en édition directe). Une spécialité est un champ ordinaire, mais ses collisions de nom doivent être traitées par le résolveur de compétences au lot R3. |
| Compétences avancées | Ajouter ligne vide, éditer nom/caractéristique/avances, supprimer. Nom reconnu peut recalculer la caractéristique depuis `WFRP_SKILLS`. Ajout/suppression et plupart des champs finissent en `recalc()` ou `save()`. | Avances réservées au MJ en correction ; nom/caractéristique en édition ordinaire sous validation. Suppression doit être une commande par ID, jamais par index. |
| Parcours XP : caractéristique | Achat applique immédiatement les avances à `carac`, puis journalise une entrée `applied` avec `targetStorage`, cible, avances et coût. | Achat transactionnel joueur ; coût recalculé serveur à partir de l’état courant et du référentiel de carrière. |
| Parcours XP : compétences de base/avancées | Achat applique les avances. La compétence avancée est créée si absente ; une spécialité personnalisée peut aussi enrichir `customSpecs`. Entrée appliquée enregistrée au journal. | Achat transactionnel joueur. Cible canonique et avances calculées côté serveur ; éviter une double ligne lors des reprises. |
| Parcours XP : talent | Achat ajoute un talent acquis, éventuellement une spécialisation libre dans `customTalents`, et journalise l’entrée appliquée. Tarif actuel : 100 XP en carrière, 200 hors carrière. | Achat joueur calculé serveur. Les spécialisations libres sont conservées ; identité canonique et exposition des répétitions sont à distinguer. |
| Parcours XP : rang/carrière | Achat « rang suivant » ou nouvelle carrière modifie `carriere`/`rang`; un changement de carrière peut pousser l’ancienne dans `careers`. Journal contient `prevCareer`. Coût actuel : 100 si la case « rang actuel terminé » est cochée, sinon 200. | Nouvelle commande : le serveur vérifie depuis la carrière effective toutes les caractéristiques disponibles du rang à 5 × rang, 8 compétences du rang à 5 × rang et un talent du rang courant ; 100 XP si les prérequis sont atteints, sinon 200. Il inclut variantes et overrides. La case UI actuelle n’est pas une preuve. |
| Parcours XP : sort | La liste et ses catégories viennent d’un CSV Google Sheets chargé par le navigateur. Le coût actuel est 50 XP par sort mineur, sinon 100, multiplié par `ceil(nombre connu de la catégorie / 5)`, plafonné à cinq crans. L’achat ajoute le sort et remplit ses détails de feuille. | L’opération doit recalculer le nombre de sorts et le coût côté serveur. Le serveur ne doit pas faire confiance au prix, au type, aux détails ni à la disponibilité issus d’un CSV client mutable. Prévoir un instantané versionné de règles partagé client/fonctions. |
| Parcours XP : miracle | Nom libre ; coût 100 XP par tranche de cinq miracles connus, hors bénédictions. L’achat ajoute une entrée prière/miracle, alimentée par Sheets si reconnue. | Recalcul serveur du nombre/coût ; nom libre accepté selon le contrat métier, mais détail/prix de Sheet ne sont jamais fournis comme vérité par le client. |
| Dépense libre | Écrit une entrée XP non appliquée (`type: Autre`, libellé et coût saisis librement). | Décision confirmée : MJ uniquement comme correction/dépense avec motif, historique et coût explicite. Bloquer la voie joueur, qui débite aujourd’hui un montant arbitraire. |
| Journal XP existant | Gains : raison et montant éditables directement puis ajoutés au début du journal. Dépenses non appliquées : type, libellé, coût et note éditables. Dépenses appliquées : note éditable ; bouton de suppression appelle `revertXpEntry()` puis retire la ligne. | Toutes ces voies sont des mutations sensibles, même si leur UI n’est pas un formulaire d’achat. Joueur : lecture, annotation éventuellement non financière ; gain/correction MJ avec motif. Interdire modification/suppression directe des écritures financières ; corriger par écriture compensatoire. Le bouton actuel retire toute trace. |
| Carrières passées | Ajouter, modifier nom/rang/note ou supprimer une ligne `careers`. | Champ ordinaire contrôlé, ligne adressée par `id`. L’annulation d’un achat de rang peut aussi retirer la carrière qui avait été archivée. |
| Talents acquis | Ajout manuel, confirmation du nom, suppression. | Acquisition manuelle sans entrée XP actuelle : MJ seulement comme correction; suppression via commande/correction avec trace. Les doublons peuvent être significatifs selon les règles et ne doivent pas être fusionnés par nom sans décision. |
| Sorts et prières hors achat | Ajouter une ligne, modifier champs et type, reconnaître une entrée depuis Sheets, supprimer. | Corrections de jeu MJ avec motif si elles changent les possessions ; les opérations d’achat normales sont joueurs et calculées. Une correction ne doit pas se faire passer pour un achat. |
| Variantes de carrière | Sélection d’une variante par rang, écrite dans `chosenVariants`. | Champ ordinaire (joueur/MJ selon le droit d’édition de fiche) avec précondition de révision et chemin autorisé. |
| Overrides de carrière | Retirer/restaurer compétences/talents du rang, éditer la liste de caractéristiques, ajouter compétences/talents. Mode édition par rang seul est un état UI non sauvegardé ; les valeurs d’override sont sauvées. | Chemins imbriqués explicitement validés côté serveur ; ne pas accepter un patch arbitraire de `careerOverrides`. Leur impact éventuel sur le calcul de coût doit être inclus au moteur commun. |
| Sections optionnelles | Toggle d’affichage / fermeture écrit `optVisible`. | Préférence de présentation, peut être locale si l’équipe choisit ; actuellement incluse dans le document cloud complet. |
| Import JSON | Vérifie seulement `_format`, demande confirmation, vide tout l’état, applique le payload et appelle `recalc()` → sauvegarde cloud. `_charId`, version export et champs ne lient pas l’import à la fiche courante. | Remplacement intégral dangereux. Joueur : soumettre un brouillon/import à comparer; champs sensibles deviennent demandes MJ, jamais importés directement. MJ : type de commande `import` avec baseRevision, aperçu/empreinte et raison; filtre de schéma côté serveur. |
| Reset fiche | Bouton MJ seulement dans la vue ; `deleteDoc(fiches/{charId})`, puis suppression des caches locaux, reload. | Supprime le document et son histoire future au lieu d’une commande traçable. Remplacer par le type de commande `reset` MJ, transactionnel, avec confirmation/raison, révision strictement croissante et événement conservé. |
| Chargement et restauration de brouillon | `load()` applique le cache local. `ficheLoadCloud()` envoie aujourd’hui au cloud toute copie `_dirty` au lieu de la comparer ; sinon remplace l’état depuis le cloud et écrit un miroir local propre. `flushAll()` déclenche sur `pagehide`/`visibilitychange`. | Un cache `_dirty` hérité est un brouillon à réconcilier champ par champ avec base locale et serveur. Aucun renvoi automatique d’un instantané complet. Les brouillons restent locaux, isolés par compte+charId+session et ne sont pas rejoués comme commandes XP. |

`exportData()` couvre : champs simples, caractéristiques, compétences de base/avancées, carrières, talents acquis/disponibles, sorts, prières, journal XP, spécialisations personnalisées, variantes, overrides, visibilité optionnelle. `talentsAvail` est actuellement transporté et rechargé même si aucun éditeur de sa valeur n’a été trouvé dans ces parcours.

## Contrat de commande proposé

Enveloppe commune envoyée à une fonction callable authentifiée :

```json
{
  "charId": "<id personnage autorisé>",
  "operationId": "<UUID v4 créé une fois et conservé au retry>",
  "baseRevision": 12,
  "type": "purchase",
  "payload": {}
}
```

L’identité de l’acteur vient du contexte Auth callable, jamais du payload. Le serveur vérifie accès courant dans `campagne/acces`, rôle, caractère, version attendue et champs autorisés. Les `operationId` sont immuables : même ID + même empreinte retourne le reçu enregistré ; même ID + contenu différent retourne `OPERATION_ID_REUSED`. Toutes les écritures d’état, reçu et événement d’historique sont atomiques. Une édition de champs contient pour chaque chemin autorisé `{ before, after }`; le serveur applique `after` seulement si la valeur courante correspond à `before`. Les chemins utilisent une liste fermée, jamais une clé d’objet arbitraire.

Commandes à exposer (noms indicatifs cohérents avec F1.3) :

| Commande | Paramètres métier | Droit / résultat |
| --- | --- | --- |
| `patch` | `changes: [{path, before, after}]` ; chemins de champ ordinaires autorisés, aucun champ XP/avance/possession acquise par ce canal | Joueur autorisé et MJ ; fusion champ par champ si `before` correspond. Une divergence retourne les valeurs serveur et conflit sans écriture. |
| `purchase` | `purchaseType`, cible canonique, `advances` et champs de choix utiles, `expectedCost`, `catalogVersion` dans `payload` | Joueur ou MJ ; état actif et coût recalculés côté serveur. Si prix calculé ≠ confirmé, `PRICE_CONFIRMATION_REQUIRED` avec proposition, aucune mutation. Achat, effet sur `data`, nouvelle entrée `xpLog`, révision, reçu et histoire atomiques. |
| `cancel` | `purchaseId` | Joueur seulement pour son dernier achat si la donnée concernée n’a pas été modifiée depuis cet achat ; MJ pour arbitrage/compensation. Le contrôle et l’inversion par ID se font dans la transaction. Répétition du même operationId retourne le reçu sans double annulation. |
| `gain` | `amount > 0`, `reason` | MJ uniquement ; crée une entrée gain stable, ne permet pas une édition/suppression de gain antérieur. |
| `correct` | correction XP ou changements d’avances/talents/sorts/prière/rang, `reason`, IDs des lignes concernées | MJ uniquement ; entrée compensatoire stable, validation cohérence fiche/journal dans une transaction. Pas de réécriture ou suppression silencieuse de l’événement source. |
| `import` | payload importé et empreinte confirmée, `reason` pour MJ | MJ commande un remplacement filtré atomique. Joueur peut obtenir un rapport/demande MJ pour tout champ sensible ; aucun import client direct. |
| `reset` | `baseRevision`, phrase/jeton de confirmation, `reason` | MJ seulement ; état remis aux valeurs par défaut dans la même enveloppe, révision strictement incrémentée et événement/reçu conservés. Ne jamais faire `deleteDoc` de la racine : les sous-collections d’historique/opérations ne seraient pas purgées avec elle. |

Réponse succès : `{status:"applied", operationId, revision, receipt, changedPaths}`. Réponses sans écriture : `REVISION_CONFLICT` (valeurs courantes des seuls chemins en conflit), `PRICE_CONFIRMATION_REQUIRED` (prix et version recalculés), `PERMISSION_DENIED`, `INVALID_COMMAND`, `SCHEMA_VERSION_UNSUPPORTED`, `CATALOG_VERSION_UNSUPPORTED`, `INSUFFICIENT_XP`, `TARGET_NOT_FOUND`, `PURCHASE_NOT_REVERSIBLE`, `OPERATION_ID_REUSED`, `RETRY_LATER`. Erreur réseau après commit est indéterminée côté navigateur : garder le même operationId et interroger/rejouer la même commande ; ne pas annoncer de succès avant reçu.

`purchase` ne reçoit jamais `cout` comme valeur de référence. `expectedCost` n’est qu’une confirmation de ce que la personne a vu. Pour l’achat de rang, le payload distingue `advanceRank` et `changeCareer`, mais n’autorise pas le client à fournir le rang de départ, les prérequis atteints ou l’état effectif de la carrière. Le serveur évalue depuis la carrière effective toutes les caractéristiques disponibles du rang à `5 × rang`, 8 compétences du rang à `5 × rang` et au moins un talent du rang courant, en tenant compte des variantes et overrides. Si tout est atteint, le coût est 100 XP, sinon 200. Cette règle suit la [FAQ WFRP officielle](https://cubicle7games.com/en_US/blog/wfrp-faq). La case à cocher du client est supprimée ou rendue informative.

## Enveloppe de fiche et journal cible

Document `fiches/{charId}` :

```json
{
  "schemaVersion": 2,
  "revision": 12,
  "data": { "...": "champs de jeu existants, compatibilité préservée" },
  "updatedAt": "serverTimestamp",
  "updatedBy": "uid interne ou identifiant fonctionnel protégé",
  "catalogVersion": "...",
  "migration": { "version": 1, "sourceHash": "...", "completedAt": "serverTimestamp" }
}
```

Sous-collections prévues au plan : `fiches/{charId}/operations/{operationId}` et `.../history/{eventId}`. Les reçus et journaux ne sont jamais écrits directement par le client. `data` conserve les clés existantes de `exportData()` pour migration/lecture progressive.

Chaque ligne de tableau éditable reçoit `id` stable : `skillsAdvanced`, `careers`, `talentsAcq`, `talentsAvail`, `sorts`, `prieres`, `xpLog`. En migration, l’ID manquant est déterminé par SHA-256 de l’empreinte source, du personnage, du nom du tableau et de l’index de la ligne ; les ID déjà présents sont préservés, les collisions globales bloquent la migration. Après cela, toutes les opérations utilisent `id`, jamais l’index. Chaque nouvel achat reçoit `purchaseId` distinct de l’idempotence d’appel (`operationId`), qu’on conserve dans l’écriture XP et le reçu. Chaque annulation a son propre `operationId` et `cancelsPurchaseId`. Les objets manipulés par clé (`skillsBasic`, `carac`, `basicSpecs`, `chosenVariants`, `careerOverrides`) gardent leur clé/couple de clés métier et sont mis à jour par patch limité.

Migration V1→V2 proposée, idempotente et sans coût XP :

1. Lire une fiche V1 et conserver ses champs `data` sans coercion/perte ; une cible qui n’existe pas reste distincte d’une valeur vide. Ne pas invalider les fiches historiques en appliquant les validations destinées aux nouvelles commandes (ex. valeurs négatives atypiques) : inventorier les anomalies sans les normaliser silencieusement.
2. Calculer une empreinte canonique du document source et lancer une transaction conditionnée à l’absence du marqueur V2 et à l’empreinte/révision source attendues.
3. Attribuer les `id` manquants aux lignes de tableaux et inscrire la correspondance `{collection, oldIndex, sourceFingerprint, id}` dans le manifeste de migration protégé. L’index n’est qu’un pointeur d’import à cette transaction, jamais une identité après migration. Ne pas écraser un ID déjà présent ; détecter les ID dupliqués comme anomalie, sans choisir silencieusement un gagnant.
4. Conserver exactement les champs d’XP historiques et attribuer un `id` à chaque entrée. Marquer les écritures héritées `origin:"legacy"`; ne pas inventer `operationId`, acteur, version de règle, coût recalculé ou achat annulable que le document ne prouve pas. Ne pas modifier les montants, l’ordre ou la signification. Reproduire explicitement la migration actuelle de `xpTotal` (gain initial seulement si aucun gain au journal) sans double compte et inscrire cette conversion dans le rapport.
5. Écrire enveloppe, journal de migration, révision initiale et marqueur en une seule transaction. Une fiche V2 marquée déjà normalisée est d’abord revalidée (révision, types des tableaux, unicité et présence des IDs) ; si elle est valide, la reprise retourne l’état existant, sinon elle bloque sans réparation implicite. Vérifier égalité des valeurs de jeu et des sommes XP avant/après ; aucun XP n’est consommé.
6. Si la transaction échoue sur modification concurrente, recalculer manifeste sur la nouvelle révision ; ne jamais restaurer le snapshot entier.

Les anciennes lignes ne fournissent pas l’acteur ou des IDs fiables. Les achats appliqués ont parfois `targetStorage`, `targetNom`, `avances`, `prevCareer`, parfois uniquement les anciens `targetType`; le bouton d’annulation actuel peut aussi supprimer une ligne sans garder trace. Les dépenses non-appliquées ont parfois un coût libre modifiable. Tous ces enregistrements restent consultables comme legacy, mais aucune annulation joueur automatique n’est autorisée avant d’avoir prouvé et migré un lien exact entre événement et effet. Les remédiations passent par une correction MJ traçable.

## Brouillons et reprise

Stockage local cible isolé par `uid + charId + schemaVersion` et une clé de session opaque. Un brouillon contient `{draftId, baseRevision, baseData, localChanges, updatedAt, status}` ; il ne contient jamais une commande d’achat en attente de replay. Les champs simples fusionnent seulement si la valeur serveur est encore `before`; les conflits gardent les deux valeurs et bloquent la sauvegarde de ce champ. Les tableaux utilisent `id` et des opérations ajout/modification/suppression, ce qui préserve les modifications distinctes et détecte édition/suppression concurrente de la même ligne. Au retour réseau, revalider identité, accès, révision et catalogVersion ; re-prévisualiser les achats depuis l’état serveur et demander confirmation si coût ou cible ont changé.

Le cache `_dirty` historique contient une photo complète sans preuve de base commune. Il ne peut être converti automatiquement en patch sûr : le comparer au snapshot serveur, proposer les champs différents et classer les conflits ; exclure tout rejeu XP automatique. Garder la récupération locale explicite, mais refuser son renvoi comme `data` complet.

## Écarts / décisions techniques à conserver

- Le plan demande `schemaVersion`, `revision`, `data`, `updatedAt`, `updatedBy`, mais précise aussi qu’on garde les clés historiques sous `data`. Le `updatedBy` doit identifier l’acteur sans devenir une adresse de joueur dans une lecture publique ; les UID et historique restent protégés.
- F1.3 dit achat calculé joueur et correction manuelle MJ, tandis que le moteur actuel propose `libre` au joueur et accepte gains/dépenses arbitraires dans le journal. Le contrat ci-dessus bloque ces voies pour les joueurs. Le MJ doit disposer d’une voie de correction avec motif, pas d’un accès sans trace.
- Les prix des compétences/caractéristiques et carrière peuvent être recalculés à partir des états/catégories ; talents dépendent de l’appartenance à carrière active. Sorts et miracles s’appuient sur Sheets côté navigateur : publier un instantané versionné ou une règle serveur déterministe avant d’autoriser l’achat correspondant.
- La case « rang actuel terminé » commande aujourd’hui le coût 100/200 sans contrôle du rang ou de son achèvement. Elle sera remplacée par le calcul serveur automatique des caractéristiques, compétences et talents acquis selon la règle confirmée.
- Un changement de carrière avec historique `prevCareer` archive l’ancienne carrière. Annuler un achat ultérieur ou annuler le rang au milieu d’autres éditions exige vérifier l’effet exact ; ne pas restaurer `prevCareer` en écrasant de nouvelles saisies.
- La collection `fiches/{charId}` sera protégée contre les `setDoc` complets des vieux onglets par règles/déploiement serveur, y compris les onglets MJ. Envoyer `baseRevision` depuis un client ne protège pas la fiche si le vieux `setDoc` reste accepté.
- Le reset actuel supprime la racine ; avec reçus et histoire en sous-collections, la suppression du parent ne les efface pas. Le reset garde le document tombstone et sa révision strictement croissante ; reçus et histoire ne sont pas purgés.
- L’export contient `_charId` et horodatage et peut inclure des valeurs non publiques. Il reste un fichier local contrôlé par l’utilisateur ; aucune fixture de dépôt ne doit contenir d’export actif, de pseudo de joueur ni d’adresse.

## Arbitrages métier confirmés

1. Décision confirmée : dépense libre MJ seulement, motif obligatoire.
2. « Rang actuel terminé » : l’état des prérequis est vérifié automatiquement par le serveur ; toutes les caractéristiques et 8 compétences disponibles au rang doivent être à 5 × rang, et un talent du rang courant doit être acquis. Pas d’attestation par case à cocher et pas d’inférence à partir des seules lignes XP achetées.
3. Décision confirmée : achat de sort/miracle refusé si la définition ou le prix de règles versionné manque ; aucun prix de secours.
4. Décision confirmée : le joueur peut annuler son dernier achat si la donnée touchée n’a pas été modifiée depuis cet achat. Les autres cas passent par le MJ.

## Références du dépôt

- `js/fiche.js` : `computeXfCost`, `validateXpPurchase`, `revertXpEntry`, rendu/écouteurs du journal, `exportData`, import, `save`/`saveNow`/`flushAll`, `applyData`, `ficheLoadCloud`, `bindAll`.
- `js/fiche-cloud.js` : `cloudSave`, lecture `getDoc`, remplacement `setDoc`, reset `deleteDoc`.
- `../../../docs/evolutions-retour-xp-2026-10-04/cahier-des-charges.md` (dossier validé hors dépôt) : décisions 8–10, collaboration et XP, migrations.
- `../../../docs/evolutions-retour-xp-2026-10-04/plan-implementation.md` (dossier validé hors dépôt) : P0.1–P0.3 et F1.1–F1.7.
- `docs/briefs/00-CONVENTIONS.md` : sécurité des données, cache/version, données publiques du dépôt.
