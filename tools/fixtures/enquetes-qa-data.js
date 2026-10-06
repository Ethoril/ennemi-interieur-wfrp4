// Personnages et contenus fictifs, sans données de joueurs.
export const records = [
    { id:'affaire', type:'enquetes', zone:'commun', titre:'Qui finance la Main Pourpre ?', question:'Suivre la piste du marchand Teugen et de son correspondant au conseil.', etat:'Ouverte', ordre:['lettre','registre'], etiquettes:['secte','argent'] },
    { id:'heritage', type:'enquetes', zone:'commun', titre:'L’héritage de Kastor Lieberung', etat:'En pause', ordre:[] },
    { id:'egouts', type:'enquetes', zone:'commun', titre:'Ce qui rampe sous Bögenhafen', etat:'Résolue', conclusion:'La créature a quitté les égouts.', ordre:[] },
    { id:'secret', type:'enquetes', zone:'mj', titre:'Les pistes secrètes du MJ', etat:'Ouverte', ordre:[] },
    { id:'lettre', type:'documents', zone:'commun', titre:'Lettre retrouvée chez le marchand', description:'Le sceau porte un soleil noir. Signée d’un simple « J. »', texte:'# Transcription\nLe conseiller attend votre réponse.\n\n> Le paiement arrivera avant le carnaval.\n\n- Le sceau porte un soleil noir.', origine:'piece', categorie:'Lettre', provenance:'Demeure du marchand', files:['qa_image'] },
    { id:'registre', type:'documents', zone:'commun', titre:'Extrait du registre des péages', description:'Trois barges de Teugen passées sans inspection.', origine:'piece', categorie:'Rapport', files:[] },
    { id:'plan', type:'documents', zone:'user:a', titre:'Plan des égouts annoté', description:'Croquis réalisé pendant la séance.', origine:'contribution', categorie:'Carte', files:[] },
    { id:'temoin', type:'documents', zone:'commun', titre:'Témoignage du batelier', texte:'Les barges passent de nuit.', origine:'piece', categorie:'Témoignage', files:[] },
    { id:'hypothese', type:'notes', zone:'user:a', titre:'Le sceau', texte:'Le sceau ressemble à celui aperçu chez le conseiller Magirius.', etiquettes:['sceau'] },
    { id:'nonclassee', type:'notes', zone:'user:a', texte:'Demander au batelier qui livre les barges.', etiquettes:[] },
    ...[['l1','lettre',''],['l2','registre',''],['l3','plan',''],['l4','marchand','Suspect'],['l5','conseiller','Destinataire présumé'],['l6','hypothese','']].map(([id,b,role])=>({id,type:'liens',zone:['plan','hypothese'].includes(b)?'user:a':'commun',a:'affaire',b,role})),
    { id:'appui', type:'relations', zone:'commun', a:'registre', b:'lettre', nature:'Appuie', texte:'Les dates des paiements correspondent.' },
    { id:'evenement', type:'evenements', zone:'commun', enquete:'affaire', titre:'Découverte de la lettre', repere:'Avant le carnaval', dateSession:'12', ordre:1, texte:'La pièce n° 1 est remise au groupe.' },
    { id:'filature', type:'evenements', zone:'commun', enquete:'affaire', titre:'Filature au port', repere:'Veille de la Schaffenfest', dateSession:'13', ordre:2, texte:'Les barges sont déchargées de nuit.' },
    { id:'a1', type:'annotations', zone:'commun', document:'lettre', fileId:'qa_image', version:1, x:.25, y:.3, width:0, height:0, texte:'Le soleil noir du sceau.' },
    { id:'a2', type:'annotations', zone:'user:a', document:'lettre', fileId:'qa_image', version:1, x:.6, y:.65, width:.2, height:.1, texte:'Cette signature semble familière.' },
].map(r=>({revision:1,authorUid:r.zone==='user:a'?'a':'gm',...r}));
export const pnjs = [
    { id:'marchand', type:'pnjs', zone:'commun', nom:'Johannes Teugen' },
    { id:'conseiller', type:'pnjs', zone:'commun', nom:'Conseiller Magirius' },
];
