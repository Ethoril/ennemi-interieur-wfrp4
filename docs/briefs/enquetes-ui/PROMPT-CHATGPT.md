# Mode d'emploi pour ChatGPT

Pour chaque brief, ouvrir une conversation (ou une tâche Codex sur le dépôt) et fournir :

1. `docs/briefs/00-CONVENTIONS.md`
2. `docs/briefs/enquetes-ui/README.md`
3. le brief du jour (`E-0x-….md`)
4. les captures `maquettes/*.png` citées par le brief (et le `.html` correspondant si l'outil
   lit les fichiers : il donne les tailles, couleurs et textes exacts)
5. les fichiers de code listés dans la ligne « Fichiers » du brief

Message de départ à coller :

> Tu implémentes le brief ci-joint dans un site statique en modules ES natifs, sans framework ni
> bundler. Les conventions (00-CONVENTIONS.md) et le README du lot priment sur le brief. Les
> maquettes montrent l'intention visuelle : reproduis la hiérarchie, les espacements et les
> couleurs via les jetons CSS du README § 3, mais construis le DOM avec `createElement` /
> `textContent` dans le style du fichier existant, sans attribut `style` ni `innerHTML`.
> Ne change ni les services, ni le schéma de données, ni le comportement non cité. Livre un diff
> par fichier, les tests demandés, et la liste de recette cochée avec ce que tu n'as pas pu
> vérifier. Si un point du brief est ambigu, pose la question avant de coder.

Après chaque brief : `npm run check`, `npm run lint`, `npm run test:enquetes`, puis recette sur
`http://localhost:8000/tools/fixtures/enquetes-qa.html` (serveur : `node tools/dev-server.mjs`).
