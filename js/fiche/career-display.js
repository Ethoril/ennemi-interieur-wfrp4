// Formes explicites : un mot inconnu reste inchangé. Les compléments après une
// préposition désignent souvent une autre personne ou un lieu et ne sont pas accordés.
const FEMININ = Object.freeze({
    abordeur: 'abordeuse', agent: 'agente', agitateur: 'agitatrice', alevin: 'alevine', ambassadeur: 'ambassadrice',
    amiral: 'amirale', apprenti: 'apprentie', arbalétrier: 'arbalétrière', archer: 'archère', arnaqueur: 'arnaqueuse',
    arpenteur: 'arpenteuse', arquebusier: 'arquebusière', artilleur: 'artilleuse', artisan: 'artisane', aspirant: 'aspirante',
    assassin: 'assassine', assermenté: 'assermentée', assistant: 'assistante', astromancien: 'astromancienne',
    bailli: 'baillie', bandit: 'bandite', baron: 'baronne', batelier: 'batelière', boucher: 'bouchère', bourgeois: 'bourgeoise',
    braconnier: 'braconnière', brasseur: 'brasseuse', bricoleur: 'bricoleuse', brocanteur: 'brocanteuse',
    broyeur: 'broyeuse', cadet: 'cadette', calculateur: 'calculatrice', cambrioleur: 'cambrioleuse', canonnier: 'canonnière',
    canotier: 'canotière', cavalier: 'cavalière', champion: 'championne', chancelier: 'chancelière', chanteur: 'chanteuse',
    charlatan: 'charlatane', chasseur: 'chasseuse', chercheur: 'chercheuse', chevalier: 'chevalière', cocher: 'cochère',
    colporteur: 'colporteuse', combattant: 'combattante', commandant: 'commandante', compagnon: 'compagne',
    conducteur: 'conductrice', conseiller: 'conseillère', consultant: 'consultante', contrebandier: 'contrebandière',
    contrefacteur: 'contrefactrice', contremaître: 'contremaîtresse', coureur: 'coureuse', cueilleur: 'cueilleuse',
    débardeur: 'débardeuse', dérangeur: 'dérangeuse', devin: 'devineresse', doyen: 'doyenne', dresseur: 'dresseuse',
    éclaireur: 'éclaireuse', écumeur: 'écumeuse', ecuyer: 'ecuyère', égoutier: 'égoutière', employé: 'employée',
    enquêteur: 'enquêtrice', ensorceleur: 'ensorceleuse', entremetteur: 'entremetteuse', érudit: 'érudite', escrimeur: 'escrimeuse',
    espion: 'espionne', étudiant: 'étudiante', explorateur: 'exploratrice', exterminateur: 'exterminatrice',
    façonneur: 'façonneuse', familier: 'familière', fauteur: 'fauteuse', fouilleur: 'fouilleuse', fraudeur: 'fraudeuse',
    frère: 'sœur', forestier: 'forestière', gardien: 'gardienne', gladiateur: 'gladiatrice', glorificateur: 'glorificatrice',
    gouverneur: 'gouverneure', grand: 'grande', guerrier: 'guerrière', hallebardier: 'hallebardière', hanté: 'hantée',
    haut: 'haute', héritier: 'héritière', indigent: 'indigente', informateur: 'informatrice', ingénieur: 'ingénieure',
    initié: 'initiée', inquisiteur: 'inquisitrice', intendant: 'intendante', interrogateur: 'interrogatrice',
    invocateur: 'invocatrice', joueur: 'joueuse', lamaneur: 'lamaneuse', lancier: 'lancière', lecteur: 'lectrice',
    maître: 'maîtresse', mangeur: 'mangeuse', marchand: 'marchande', marcheur: 'marcheuse', marin: 'marine',
    martelier: 'martelière', mendiant: 'mendiante', meneur: 'meneuse', messager: 'messagère', milicien: 'milicienne',
    mineur: 'mineuse', muletier: 'muletière', musicien: 'musicienne', naufrageur: 'naufrageuse', négociant: 'négociante',
    officiant: 'officiante', officier: 'officière', ombremancien: 'ombremancienne', patrouilleur: 'patrouilleuse',
    paysan: 'paysanne', péager: 'péagère', pénitent: 'pénitente', percepteur: 'perceptrice', pillard: 'pillarde',
    pilleur: 'pilleuse', piquier: 'piquière', pisteur: 'pisteuse', pleureur: 'pleureuse', porteur: 'porteuse',
    pourvoyeur: 'pourvoyeuse', préfet: 'préfète', premier: 'première', prêtre: 'prêtresse', prince: 'princesse',
    professionnel: 'professionnelle', prophète: 'prophétesse', prospecteur: 'prospectrice', prostitué: 'prostituée',
    psychométricien: 'psychométricienne', pyromancien: 'pyromancienne', rançonneur: 'rançonneuse', ratier: 'ratière',
    receleur: 'receleuse', régisseur: 'régisseuse', répurgateur: 'répurgatrice', rôdeur: 'rôdeuse', roi: 'reine',
    sapeur: 'sapeuse', scelleur: 'scelleuse', seigneur: 'seigneure', serviteur: 'servante', soldat: 'soldate',
    sorcier: 'sorcière', souteneur: 'souteneuse', suiveur: 'suiveuse', survivant: 'survivante', tireur: 'tireuse',
    tisseur: 'tisseuse', tonnerier: 'tonnerière', trafiquant: 'trafiquante', transmutateur: 'transmutatrice',
    traqueur: 'traqueuse', tueur: 'tueuse', vagabond: 'vagabonde', valet: 'servante', villageois: 'villageoise',
    voleur: 'voleuse', voyant: 'voyante', léger: 'légère', franc: 'franche', spirituel: 'spirituelle', secret: 'secrète',
    gris: 'grise', agréé: 'agréée', exilé: 'exilée', céleste: 'céleste', vétéran: 'vétérane', dissident: 'dissidente',
    itinérant: 'itinérante', aguerri: 'aguerrie', routier: 'routière', fluvial: 'fluviale', nouveau: 'nouvelle',
});

export function careerDisplayName(value, genre) {
    const name = String(value || '');
    if (genre !== 'feminin') return name;
    const boundary = name.search(/\s(?:de|du|des|d['’]|à|sur|en)\b|\s*\(/iu);
    const prefix = boundary < 0 ? name : name.slice(0, boundary);
    const suffix = boundary < 0 ? '' : name.slice(boundary);
    return prefix.replace(/[\p{L}]+/gu, word => {
        const replacement = FEMININ[word.toLocaleLowerCase('fr')];
        if (!replacement) return word;
        return word[0] === word[0].toLocaleUpperCase('fr')
            ? replacement[0].toLocaleUpperCase('fr') + replacement.slice(1) : replacement;
    }) + suffix;
}
