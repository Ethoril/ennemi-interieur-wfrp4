import { canonicalSkillNom, sameSkill } from './skill-names.js';

// Groupes de base affichés sur la fiche bureau et utilisés pour leur prix XP.
export const BASIC_SKILLS = [
    { nom: 'Art', carac: 'dex' },
    { nom: 'Athlétisme', carac: 'ag' },
    { nom: 'Calme', carac: 'fm' },
    { nom: 'Charme', carac: 'soc' },
    { nom: 'Chevaucher', carac: 'ag' },
    { nom: 'Commandement', carac: 'soc' },
    { nom: "Conduite d'attelage", carac: 'ag' },
    { nom: 'Corps à corps (Base)', carac: 'cc' },
    { nom: 'Discrétion', carac: 'ag' },
    { nom: 'Divertissement', carac: 'soc' },
    { nom: 'Emprise sur les animaux', carac: 'fm' },
    { nom: 'Escalade', carac: 'f' },
    { nom: 'Esquive', carac: 'ag' },
    { nom: 'Intimidation', carac: 'f' },
    { nom: 'Intuition', carac: 'i' },
    { nom: 'Marchandage', carac: 'soc' },
    { nom: 'Orientation', carac: 'i' },
    { nom: 'Pari', carac: 'int' },
    { nom: 'Perception', carac: 'i' },
    { nom: 'Ragot', carac: 'soc' },
    { nom: 'Ramer', carac: 'f' },
    { nom: 'Résistance', carac: 'e' },
    { nom: "Résistance à l'alcool", carac: 'e' },
    { nom: 'Subornation', carac: 'soc' },
    { nom: 'Survie en extérieur', carac: 'int' },
];

export function getCaracForGroup(group, skills = []) {
    return skills.find(skill => skill.group === group)?.carac || 'int';
}

export function basicSkillNom(name, basicSpecs = {}) {
    const spec = basicSpecs[name];
    return spec ? canonicalSkillNom(`${name} (${spec})`) : name;
}

export function basicRowFor(fullName, basicSpecs = {}) {
    if (!fullName) return null;
    return BASIC_SKILLS.find(skill => skill.nom === fullName
        || (basicSpecs[skill.nom] && sameSkill(basicSkillNom(skill.nom, basicSpecs), fullName)))?.nom || null;
}
