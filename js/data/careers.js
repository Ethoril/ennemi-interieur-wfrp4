'use strict';

// Base de données des carrières WFRP4 (fr). Données à compléter quand le sheets complet sera fourni.
// Pour la correspondance carrière/compétences, le nom de base est extrait avant la parenthèse.
const WFRP_CAREERS = [
    {
        id: 'agitateur',
        nom: 'Agitateur',
        carac: ['i', 'ag'],
        rangs: [
            {
                rang: 1,
                titre: 'Pamphlétaire',
                statut: 'Bronze 1',
                skills: [
                    'Art (Écriture)', 'Charme', 'Marchandage', 'Métier (Imprimerie)',
                    'Ragot', "Résistance à l'alcool", 'Savoir (Politique)', 'Subornation',
                ],
                talents: ['Baratiner', 'Faire la manche', 'Lire/Écrire', 'Sociable'],
            },
            {
                rang: 2,
                titre: 'Agitateur',
                statut: 'Bronze 2',
                skills: [
                    'Calme', 'Commandement', 'Divertissement (Narration)',
                    'Esquive', 'Intuition', 'Pari',
                ],
                talents: ['Chat de gouttière', 'Ergoteur', 'Ferveur ardente', 'Orateur'],
            },
            {
                rang: 3,
                titre: 'Fauteur de Troubles',
                statut: 'Bronze 3',
                skills: [
                    'Athlétisme', 'Corps à Corps (Bagarre)', 'Intimidation', 'Perception',
                ],
                talents: ['Combat déloyal', 'Fuite!', 'Menteur', 'Pas de côté'],
            },
            {
                rang: 4,
                titre: 'Démagogue',
                statut: 'Bronze 5',
                skills: [
                    'Chevaucher (Cheval)', 'Savoir (Héraldique)',
                ],
                talents: ['Affable', 'Grand orateur', 'Intrigant', 'Savoir-vivre (au choix)'],
            },
        ],
    },
    {
        id: 'artisan',
        nom: 'Artisan',
        carac: ['f', 'e', 'dex'],
        rangs: [
            {
                rang: 1,
                titre: 'Apprenti Artisan',
                statut: 'Bronze 2',
                skills: [
                    'Athlétisme', 'Calme', 'Discrétion (Urbaine)', 'Esquive',
                    'Évaluation', 'Métier (au choix)', 'Résistance', "Résistance à l'alcool",
                ],
                talents: ['Artiste', 'Infatigable', 'Maître artisan (au choix)', 'Très fort'],
            },
            {
                rang: 2,
                titre: 'Artisan',
                statut: 'Argent 1',
                skills: [
                    'Charme', 'Langue (guilde)', 'Marchandage', 'Perception',
                    'Savoir (Région)', 'Ragot',
                ],
                talents: ['Costaud', 'Doigts de fée', 'Négociateur', 'Savoir-vivre (guilde)'],
            },
            {
                rang: 3,
                titre: 'Maître Artisan',
                statut: 'Argent 3',
                skills: [
                    'Commandement', 'Intuition', 'Recherche', 'Signes secrets (guilde)',
                ],
                talents: ['Bricoleur', 'Lire/Écrire', 'Travailleur qualifié (au choix)', 'Sens aiguisé (Goût ou Toucher)'],
            },
            {
                rang: 4,
                titre: 'Maître de Guilde',
                statut: 'Or 1',
                skills: [
                    'Intimidation', 'Subornation',
                ],
                talents: ['Intrigant', 'Magnum Opus', 'Orateur', 'Suborneur'],
            },
        ],
    },
    {
        id: 'bourgeois',
        nom: 'Bourgeois',
        carac: ['i'],
        rangs: [
            {
                rang: 1,
                titre: 'Employé',
                statut: 'Argent 1',
                skills: [
                    'Charme', "Conduite d'attelage", 'Escalade', 'Esquive',
                    'Marchandage', 'Pari', 'Ragot', "Résistance à l'alcool",
                ],
                talents: ['Chat de gouttière', 'Costaud', 'Insignifiant', 'Savoir-vivre (Serviteurs)'],
            },
            {
                rang: 2,
                titre: 'Bourgeois',
                statut: 'Argent 2',
                skills: [
                    'Corps à Corps (Bagarre)', 'Évaluation', 'Musicien (au choix)',
                    'Intuition', 'Savoir (Région)', 'Subornation',
                ],
                talents: ['Escroquer', 'Négociateur', 'Savoir-vivre (au choix)', 'Sociable'],
            },
            {
                rang: 3,
                titre: 'Conseiller Municipal',
                statut: 'Argent 5',
                skills: [
                    'Calme', 'Perception', 'Recherche', 'Savoir (Loi)',
                ],
                talents: ['Coopératif', 'Lire/Écrire', 'Orateur', 'Suborneur'],
            },
            {
                rang: 4,
                titre: 'Bourgmestre',
                statut: 'Or 1',
                skills: [
                    'Intimidation', 'Savoir (Politique)',
                ],
                talents: ['Affable', 'Grand orateur', 'Intrigant', 'Présence imposante'],
            },
        ],
    },
];

// Exposition globale (const ne s'attache pas à window dans les balises <script>)
window.WFRP_CAREERS = WFRP_CAREERS;
