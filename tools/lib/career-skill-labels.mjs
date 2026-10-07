const groups = {
    'Animal Care': 'Soin aux animaux', 'Animal Training': 'Dressage', Athletics: 'Athlétisme', Bribery: 'Subornation',
    Channelling: 'Focalisation', Charm: 'Charme', 'Charm Animal': 'Emprise sur les animaux', Climb: 'Escalade',
    'Consume Alcohol': "Résistance à l'alcool", Cool: 'Calme', Dodge: 'Esquive', Drive: "Conduite d'attelage",
    Endurance: 'Résistance', Evaluate: 'Évaluation', Gossip: 'Ragot', Haggle: 'Marchandage', Heal: 'Guérison',
    Intimidate: 'Intimidation', Language: 'Langue', Leadership: 'Commandement', Lore: 'Savoir', Melee: 'Corps à corps',
    Navigation: 'Orientation', 'Outdoor Survival': 'Survie en extérieur', Ranged: 'Projectiles', Research: 'Recherche',
    Ride: 'Chevaucher', Row: 'Ramer', Sail: 'Voile', 'Secret Signs': 'Signes secrets', 'Set Trap': 'Piégeage',
    Stealth: 'Discrétion', Swim: 'Natation', Track: 'Pistage', Trade: 'Métier',
};
const specs = { Any: 'au choix', Magick: 'Magick', Local: 'Région', Magic: 'Magie', 'Old Ones': 'Anciens',
    Basic: 'Base', Polearm: "Armes d'hast", Blackpowder: 'Poudre noire', Throwing: 'Lancer', Horse: 'Cheval',
    Lizardman: 'Hommes-lézards', Ranger: 'Ranger', Rural: 'Rurale', Cartographer: 'Cartographe',
    'Azyr or Ghur': 'Azyr ou Ghur' };

export function careerSkillLabel(value) {
    const match = value.match(/^(.*?)\s*\(([^()]*)\)$/u);
    const base = match ? match[1] : value;
    if (!groups[base] && base !== 'Art') return value;
    return `${groups[base] || base}${match ? ` (${specs[match[2]] || match[2]})` : ''}`;
}
