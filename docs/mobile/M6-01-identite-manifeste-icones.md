# M6-01 — Identité, manifeste et icônes

## Périmètre

Le manifeste racine reste l’unique manifeste du site bureau et de `/app/`. Le point de démarrage
public reste volontairement `./index.html`; aucune bascule vers `./app/index.html`, aucun second
service worker et aucune annonce d’installation ne sont introduits dans ce lot.

## Identité mesurée sur le déploiement

La lecture navigateur, effectuée en lecture seule sur le déploiement réel du 25 août 2026, est
consignée ici :

- URL du manifeste : `https://ethoril.github.io/ennemi-interieur-wfrp4/manifest.json` ;
- aucun champ `id` avant M6-01 ;
- `start_url: ./index.html`, résolu en
  `https://ethoril.github.io/ennemi-interieur-wfrp4/index.html` ;
- scope dérivé : `https://ethoril.github.io/ennemi-interieur-wfrp4/`.

En l’absence de `id`, Chrome utilise `start_url` comme identité de repli. Le champ
`id: ./index.html` ajouté par M6-01 se résout donc exactement vers cette même identité historique,
conformément à la [procédure Chrome](https://developer.chrome.com/docs/capabilities/pwa-manifest-id).
La présence de l’ancienne installation dans `about://web-app-internals/` et la mise à jour
avant/après sur Android restent à contrôler physiquement ; elles ne sont pas déduites de cette seule
lecture du manifeste.

## Icônes et balises

Les PNG sont générés mécaniquement par `tools/m6-01-generate-icons.mjs` depuis
`icons/icon-source.svg`, qui reprend l’identité sombre et or de `favicon.svg` sans service d’image
ni donnée externe. Les fichiers livrés sont `192 × 192` et `512 × 512` en `purpose: any`, un
`512 × 512` maskable avec fond opaque et zone sûre centrale, ainsi qu’une icône Apple Touch
`180 × 180`. Le favicon SVG existant est conservé.

`app/index.html` pointe vers `../manifest.json`, `../favicon.svg` et l’icône Apple Touch. Les pages
du bureau continuent de pointer vers `manifest.json`; il n’y a donc pas de manifeste concurrent.

## Contrôles exécutés

- `npm run test:m6-01` : manifeste, résolution sous-chemin, graphe des liens, signatures PNG,
  dimensions, canal alpha, fichier source et zone maskable ;
- `npm run lint` ;
- `npm run check` ;
- `git diff --check`.

Le serveur local a aussi renvoyé le manifeste et les quatre PNG avec un code HTTP 200 et leur type
attendu ; la coque `/app/` a résolu le manifeste, le favicon et l’icône Apple sans erreur console.

Ces contrôles automatisés ne remplacent pas une installation physique. L’installation Android
avant/après et la vérification d’une mise à jour de la même icône n’ont pas été effectuées dans ce
lot. La validation iOS est explicitement différée. Aucun test de production, émulateur ou appareil
réel n’est déclaré ici.

Conformément au lot individuel, `APP_VERSION`, le cache du service worker et `CHANGELOG.md` ne sont
pas modifiés par M6-01.
