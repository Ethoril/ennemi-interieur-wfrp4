'use strict';

// Base de données complète des compétences WFRP4 (fr).
// Chaque spécialisation = une entrée distincte.
// group  : nom de la compétence de base (pour regrouper dans les listes)
// spec   : spécialisation ('' si aucune)
// nom    : nom complet affiché  (group + ' (spec)' si spec)
// carac  : code de la caractéristique associée
// basic  : true = compétence de base (tous les PJ l'ont à la valeur de carac)

const WFRP_SKILLS = [
    // ── Compétences de base — sans spécialisation ──────────
    { group:'Athlétisme',             spec:'',                   nom:'Athlétisme',                        carac:'ag',  basic:true  },
    { group:'Calme',                  spec:'',                   nom:'Calme',                             carac:'fm',  basic:true  },
    { group:'Charme',                 spec:'',                   nom:'Charme',                            carac:'soc', basic:true  },
    { group:'Commandement',           spec:'',                   nom:'Commandement',                      carac:'soc', basic:true  },
    { group:'Conduite',               spec:'',                   nom:'Conduite',                          carac:'ag',  basic:true  },
    { group:'Emprise sur les animaux',spec:'',                   nom:'Emprise sur les animaux',           carac:'fm',  basic:true  },
    { group:'Escalade',               spec:'',                   nom:'Escalade',                          carac:'f',   basic:true  },
    { group:'Esquive',                spec:'',                   nom:'Esquive',                           carac:'ag',  basic:true  },
    { group:'Intimidation',           spec:'',                   nom:'Intimidation',                      carac:'f',   basic:true  },
    { group:'Intuition',              spec:'',                   nom:'Intuition',                         carac:'i',   basic:true  },
    { group:'Marchandage',            spec:'',                   nom:'Marchandage',                       carac:'soc', basic:true  },
    { group:'Orientation',            spec:'',                   nom:'Orientation',                       carac:'i',   basic:true  },
    { group:'Pari',                   spec:'',                   nom:'Pari',                              carac:'int', basic:true  },
    { group:'Perception',             spec:'',                   nom:'Perception',                        carac:'i',   basic:true  },
    { group:'Ragot',                  spec:'',                   nom:'Ragot',                             carac:'soc', basic:true  },
    { group:'Ramer',                  spec:'',                   nom:'Ramer',                             carac:'f',   basic:true  },
    { group:'Résistance',             spec:'',                   nom:'Résistance',                        carac:'e',   basic:true  },
    { group:"Résistance à l'alcool",  spec:'',                   nom:"Résistance à l'alcool",             carac:'e',   basic:true  },
    { group:'Subornation',            spec:'',                   nom:'Subornation',                       carac:'soc', basic:true  },
    { group:'Survie en extérieur',    spec:'',                   nom:'Survie en extérieur',               carac:'int', basic:true  },

    // ── Compétences de base — avec spécialisations ─────────
    // Art
    { group:'Art', spec:'Calligraphie', nom:'Art (Calligraphie)', carac:'dex', basic:true },
    { group:'Art', spec:'Cartographie', nom:'Art (Cartographie)', carac:'dex', basic:true },
    { group:'Art', spec:'Écriture',     nom:'Art (Écriture)',     carac:'dex', basic:true },
    { group:'Art', spec:'Gravure',      nom:'Art (Gravure)',      carac:'dex', basic:true },
    { group:'Art', spec:'Mosaïque',     nom:'Art (Mosaïque)',     carac:'dex', basic:true },
    { group:'Art', spec:'Peinture',     nom:'Art (Peinture)',     carac:'dex', basic:true },
    { group:'Art', spec:'Sculpture',    nom:'Art (Sculpture)',    carac:'dex', basic:true },
    { group:'Art', spec:'Tatouage',     nom:'Art (Tatouage)',     carac:'dex', basic:true },
    { group:'Art', spec:'Tissage',      nom:'Art (Tissage)',      carac:'dex', basic:true },

    // Chevaucher
    { group:'Chevaucher', spec:'Cheval',       nom:'Chevaucher (Cheval)',       carac:'ag', basic:true },
    { group:'Chevaucher', spec:'Demi-griffon', nom:'Chevaucher (Demi-griffon)', carac:'ag', basic:true },
    { group:'Chevaucher', spec:'Griffon',      nom:'Chevaucher (Griffon)',      carac:'ag', basic:true },
    { group:'Chevaucher', spec:'Loup géant',   nom:'Chevaucher (Loup géant)',   carac:'ag', basic:true },
    { group:'Chevaucher', spec:'Pégase',       nom:'Chevaucher (Pégase)',       carac:'ag', basic:true },

    // Corps à corps — version de base (spécialisation "Base")
    { group:'Corps à corps', spec:'Base', nom:'Corps à corps (Base)', carac:'cc', basic:true },

    // Discrétion
    { group:'Discrétion', spec:'Rurale',      nom:'Discrétion (Rurale)',      carac:'ag', basic:true },
    { group:'Discrétion', spec:'Souterraine', nom:'Discrétion (Souterraine)', carac:'ag', basic:true },
    { group:'Discrétion', spec:'Urbaine',     nom:'Discrétion (Urbaine)',     carac:'ag', basic:true },

    // Divertissement
    { group:'Divertissement', spec:'Chant',       nom:'Divertissement (Chant)',       carac:'soc', basic:true },
    { group:'Divertissement', spec:'Comédie',     nom:'Divertissement (Comédie)',     carac:'soc', basic:true },
    { group:'Divertissement', spec:'Discours',    nom:'Divertissement (Discours)',    carac:'soc', basic:true },
    { group:'Divertissement', spec:'Humour',      nom:'Divertissement (Humour)',      carac:'soc', basic:true },
    { group:'Divertissement', spec:'Narration',   nom:'Divertissement (Narration)',   carac:'soc', basic:true },
    { group:'Divertissement', spec:'Provocation', nom:'Divertissement (Provocation)', carac:'soc', basic:true },

    // ── Compétences avancées — sans spécialisation ─────────
    { group:'Crochetage',       spec:'', nom:'Crochetage',       carac:'dex', basic:false },
    { group:'Escamotage',       spec:'', nom:'Escamotage',       carac:'dex', basic:false },
    { group:'Évaluation',       spec:'', nom:'Évaluation',       carac:'int', basic:false },
    { group:'Focalisation',     spec:'', nom:'Focalisation',     carac:'fm',  basic:false },
    { group:'Guérison',         spec:'', nom:'Guérison',         carac:'int', basic:false },
    { group:'Hypnotisme',       spec:'', nom:'Hypnotisme',       carac:'int', basic:false },
    { group:'Natation',         spec:'', nom:'Natation',         carac:'f',   basic:false },
    { group:'Piégeage',         spec:'', nom:'Piégeage',         carac:'dex', basic:false },
    { group:'Pistage',          spec:'', nom:'Pistage',          carac:'i',   basic:false },
    { group:'Prière',           spec:'', nom:'Prière',           carac:'soc', basic:false },
    { group:'Recherche',        spec:'', nom:'Recherche',        carac:'int', basic:false },
    { group:'Représentation',   spec:'', nom:'Représentation',   carac:'ag',  basic:false },
    { group:'Soins aux animaux',spec:'', nom:'Soins aux animaux',carac:'int', basic:false },

    // ── Compétences avancées — avec spécialisations ────────
    // Corps à corps (avancé)
    { group:'Corps à corps', spec:"Armes d'hast", nom:"Corps à corps (Armes d'hast)", carac:'cc', basic:false },
    { group:'Corps à corps', spec:'Bagarre',      nom:'Corps à corps (Bagarre)',       carac:'cc', basic:false },
    { group:'Corps à corps', spec:'Cavalerie',    nom:'Corps à corps (Cavalerie)',     carac:'cc', basic:false },
    { group:'Corps à corps', spec:'Escrime',      nom:'Corps à corps (Escrime)',       carac:'cc', basic:false },
    { group:'Corps à corps', spec:'Fléaux',       nom:'Corps à corps (Fléaux)',        carac:'cc', basic:false },
    { group:'Corps à corps', spec:'Lourde',       nom:'Corps à corps (Lourde)',        carac:'cc', basic:false },
    { group:'Corps à corps', spec:'Parade',       nom:'Corps à corps (Parade)',        carac:'cc', basic:false },

    // Dressage
    { group:'Dressage', spec:'Chevaux', nom:'Dressage (Chevaux)', carac:'int', basic:false },
    { group:'Dressage', spec:'Chiens',  nom:'Dressage (Chiens)',  carac:'int', basic:false },
    { group:'Dressage', spec:'Ours',    nom:'Dressage (Ours)',    carac:'int', basic:false },
    { group:'Dressage', spec:'Pigeons', nom:'Dressage (Pigeons)', carac:'int', basic:false },

    // Langue
    { group:'Langue', spec:'Albionese',           nom:'Langue (Albionese)',           carac:'int', basic:false },
    { group:'Langue', spec:'Bataille',             nom:'Langue (Bataille)',             carac:'int', basic:false },
    { group:'Langue', spec:'Bretonnien',           nom:'Langue (Bretonnien)',           carac:'int', basic:false },
    { group:'Langue', spec:'Cathayen',             nom:'Langue (Cathayen)',             carac:'int', basic:false },
    { group:'Langue', spec:'Classique',            nom:'Langue (Classique)',            carac:'int', basic:false },
    { group:'Langue', spec:'Eltharin',             nom:'Langue (Eltharin)',             carac:'int', basic:false },
    { group:'Langue', spec:'Estalien',             nom:'Langue (Estalien)',             carac:'int', basic:false },
    { group:'Langue', spec:'Gospodar',             nom:'Langue (Gospodar)',             carac:'int', basic:false },
    { group:'Langue', spec:'Grumbarth',            nom:'Langue (Grumbarth)',            carac:'int', basic:false },
    { group:'Langue', spec:'Khazalid',             nom:'Langue (Khazalid)',             carac:'int', basic:false },
    { group:'Langue', spec:'Magick',               nom:'Langue (Magick)',               carac:'int', basic:false },
    { group:'Langue', spec:'Mootish',              nom:'Langue (Mootish)',              carac:'int', basic:false },
    { group:'Langue', spec:'Norse',                nom:'Langue (Norse)',                carac:'int', basic:false },
    { group:'Langue', spec:'Queekish',             nom:'Langue (Queekish)',             carac:'int', basic:false },
    { group:'Langue', spec:'Reikspiel',            nom:'Langue (Reikspiel)',            carac:'int', basic:false },
    { group:'Langue', spec:'Sombre / Dark Tongue', nom:'Langue (Sombre / Dark Tongue)', carac:'int', basic:false },
    { group:'Langue', spec:'Tiléen',               nom:'Langue (Tiléen)',               carac:'int', basic:false },
    { group:'Langue', spec:'Wastelander',          nom:'Langue (Wastelander)',          carac:'int', basic:false },

    // Métier
    { group:'Métier', spec:'Apothicaire',  nom:'Métier (Apothicaire)',  carac:'dex', basic:false },
    { group:'Métier', spec:'Armurier',     nom:'Métier (Armurier)',     carac:'dex', basic:false },
    { group:'Métier', spec:'Bâtelier',     nom:'Métier (Bâtelier)',     carac:'dex', basic:false },
    { group:'Métier', spec:'Brasseur',     nom:'Métier (Brasseur)',     carac:'dex', basic:false },
    { group:'Métier', spec:'Calligraphe',  nom:'Métier (Calligraphe)',  carac:'dex', basic:false },
    { group:'Métier', spec:'Charpentier',  nom:'Métier (Charpentier)',  carac:'dex', basic:false },
    { group:'Métier', spec:'Cordonnier',   nom:'Métier (Cordonnier)',   carac:'dex', basic:false },
    { group:'Métier', spec:'Cuisinier',    nom:'Métier (Cuisinier)',    carac:'dex', basic:false },
    { group:'Métier', spec:'Embaumeur',    nom:'Métier (Embaumeur)',    carac:'dex', basic:false },
    { group:'Métier', spec:'Empoisonneur', nom:'Métier (Empoisonneur)', carac:'dex', basic:false },
    { group:'Métier', spec:'Forgeron',     nom:'Métier (Forgeron)',     carac:'dex', basic:false },
    { group:'Métier', spec:'Herboriste',   nom:'Métier (Herboriste)',   carac:'dex', basic:false },
    { group:'Métier', spec:'Imprimeur',    nom:'Métier (Imprimeur)',    carac:'dex', basic:false },
    { group:'Métier', spec:'Ingénieur',    nom:'Métier (Ingénieur)',    carac:'dex', basic:false },
    { group:'Métier', spec:'Joaillier',    nom:'Métier (Joaillier)',    carac:'dex', basic:false },
    { group:'Métier', spec:'Maçon',        nom:'Métier (Maçon)',        carac:'dex', basic:false },
    { group:'Métier', spec:'Marchand',     nom:'Métier (Marchand)',     carac:'dex', basic:false },
    { group:'Métier', spec:'Orfèvre',      nom:'Métier (Orfèvre)',      carac:'dex', basic:false },
    { group:'Métier', spec:'Tanneur',      nom:'Métier (Tanneur)',      carac:'dex', basic:false },

    // Musicien
    { group:'Musicien', spec:'Clavecin',  nom:'Musicien (Clavecin)',  carac:'dex', basic:false },
    { group:'Musicien', spec:'Cor',       nom:'Musicien (Cor)',       carac:'dex', basic:false },
    { group:'Musicien', spec:'Cornemuse', nom:'Musicien (Cornemuse)', carac:'dex', basic:false },
    { group:'Musicien', spec:'Luth',      nom:'Musicien (Luth)',      carac:'dex', basic:false },
    { group:'Musicien', spec:'Tambour',   nom:'Musicien (Tambour)',   carac:'dex', basic:false },

    // Projectiles
    { group:'Projectiles', spec:'Arbalète',       nom:'Projectiles (Arbalète)',       carac:'ct', basic:false },
    { group:'Projectiles', spec:'Arc',             nom:'Projectiles (Arc)',             carac:'ct', basic:false },
    { group:'Projectiles', spec:'Armes à poudre', nom:'Projectiles (Armes à poudre)', carac:'ct', basic:false },
    { group:'Projectiles', spec:'Explosifs',       nom:'Projectiles (Explosifs)',       carac:'ct', basic:false },
    { group:'Projectiles', spec:'Fronde',          nom:'Projectiles (Fronde)',          carac:'ct', basic:false },
    { group:'Projectiles', spec:'Ingénierie',      nom:'Projectiles (Ingénierie)',      carac:'ct', basic:false },
    { group:'Projectiles', spec:'Jet',             nom:'Projectiles (Jet)',             carac:'ct', basic:false },
    { group:'Projectiles', spec:'Lance-flammes',   nom:'Projectiles (Lance-flammes)',   carac:'ct', basic:false },

    // Savoir
    { group:'Savoir', spec:'Altdorf',     nom:'Savoir (Altdorf)',     carac:'int', basic:false },
    { group:'Savoir', spec:'Anatomie',    nom:'Savoir (Anatomie)',    carac:'int', basic:false },
    { group:'Savoir', spec:'Bêtes',       nom:'Savoir (Bêtes)',       carac:'int', basic:false },
    { group:'Savoir', spec:'Chimie',      nom:'Savoir (Chimie)',      carac:'int', basic:false },
    { group:'Savoir', spec:'Démons',      nom:'Savoir (Démons)',      carac:'int', basic:false },
    { group:'Savoir', spec:'Droit',       nom:'Savoir (Droit)',       carac:'int', basic:false },
    { group:'Savoir', spec:'Empire',      nom:'Savoir (Empire)',      carac:'int', basic:false },
    { group:'Savoir', spec:'Géologie',    nom:'Savoir (Géologie)',    carac:'int', basic:false },
    { group:'Savoir', spec:'Héraldique',  nom:'Savoir (Héraldique)',  carac:'int', basic:false },
    { group:'Savoir', spec:'Histoire',    nom:'Savoir (Histoire)',    carac:'int', basic:false },
    { group:'Savoir', spec:'Ingénierie',  nom:'Savoir (Ingénierie)',  carac:'int', basic:false },
    { group:'Savoir', spec:'Locale',      nom:'Savoir (Locale)',      carac:'int', basic:false },
    { group:'Savoir', spec:'Magie',       nom:'Savoir (Magie)',       carac:'int', basic:false },
    { group:'Savoir', spec:'Médecine',    nom:'Savoir (Médecine)',    carac:'int', basic:false },
    { group:'Savoir', spec:'Métallurgie', nom:'Savoir (Métallurgie)', carac:'int', basic:false },
    { group:'Savoir', spec:'Middenheim',  nom:'Savoir (Middenheim)',  carac:'int', basic:false },
    { group:'Savoir', spec:'Nains',       nom:'Savoir (Nains)',       carac:'int', basic:false },
    { group:'Savoir', spec:'Plantes',     nom:'Savoir (Plantes)',     carac:'int', basic:false },
    { group:'Savoir', spec:'Politique',   nom:'Savoir (Politique)',   carac:'int', basic:false },
    { group:'Savoir', spec:'Reikland',    nom:'Savoir (Reikland)',    carac:'int', basic:false },
    { group:'Savoir', spec:'Runes',       nom:'Savoir (Runes)',       carac:'int', basic:false },
    { group:'Savoir', spec:'Science',     nom:'Savoir (Science)',     carac:'int', basic:false },
    { group:'Savoir', spec:'Skavens',     nom:'Savoir (Skavens)',     carac:'int', basic:false },
    { group:'Savoir', spec:'Sorcières',   nom:'Savoir (Sorcières)',   carac:'int', basic:false },
    { group:'Savoir', spec:'Théologie',   nom:'Savoir (Théologie)',   carac:'int', basic:false },
    { group:'Savoir', spec:'Trolls',      nom:'Savoir (Trolls)',      carac:'int', basic:false },

    // Signes secrets
    { group:'Signes secrets', spec:'Braconnier',    nom:'Signes secrets (Braconnier)',    carac:'int', basic:false },
    { group:'Signes secrets', spec:'Contrebandier', nom:'Signes secrets (Contrebandier)', carac:'int', basic:false },
    { group:'Signes secrets', spec:'Cultiste',      nom:'Signes secrets (Cultiste)',      carac:'int', basic:false },
    { group:'Signes secrets', spec:'Éclaireur',     nom:'Signes secrets (Éclaireur)',     carac:'int', basic:false },
    { group:'Signes secrets', spec:'Espion',        nom:'Signes secrets (Espion)',        carac:'int', basic:false },
    { group:'Signes secrets', spec:'Guilde',        nom:'Signes secrets (Guilde)',        carac:'int', basic:false },
    { group:'Signes secrets', spec:'Skaven',        nom:'Signes secrets (Skaven)',        carac:'int', basic:false },
    { group:'Signes secrets', spec:'Vagabond',      nom:'Signes secrets (Vagabond)',      carac:'int', basic:false },
    { group:'Signes secrets', spec:'Voleur',        nom:'Signes secrets (Voleur)',        carac:'int', basic:false },

    // Voile
    { group:'Voile', spec:'Aéronef nain', nom:'Voile (Aéronef nain)', carac:'ag', basic:false },
    { group:'Voile', spec:'Barge',        nom:'Voile (Barge)',         carac:'ag', basic:false },
    { group:'Voile', spec:'Caravelle',    nom:'Voile (Caravelle)',     carac:'ag', basic:false },
    { group:'Voile', spec:'Cogue',        nom:'Voile (Cogue)',         carac:'ag', basic:false },
    { group:'Voile', spec:'Drakkar',      nom:'Voile (Drakkar)',       carac:'ag', basic:false },
];

// Groupes ayant des spécialisations (base ou avancée)
const WFRP_SKILL_GROUPS_WITH_SPECS = [
    ...new Set(WFRP_SKILLS.filter(s => s.spec).map(s => s.group)),
];
