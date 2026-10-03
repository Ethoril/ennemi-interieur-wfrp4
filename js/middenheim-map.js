// Public geographic reference shared by Cartes and the private Carnaval view.
// Coordinates are pixels in img/middenheim.webp (2000 × 1340), origin top-left.
export const MIDDENHEIM_MAP = {
    image: 'img/middenheim.webp',
    width: 2000,
    height: 1340,
    places: [
        { id: 'place-parades', name: 'Place des Parades', x: 1215, y: 365, mapLabel: '25' },
        { id: 'grand-parc', name: 'Grand Parc', x: 1360, y: 640, radius: 110 },
        { id: 'jardins-royaux', name: 'Jardins Royaux', x: 1520, y: 337, mapLabel: '3' },
        { id: 'college-musique', name: 'Collège royal de Musique', x: 1590, y: 490, mapLabel: '4' },
        { id: 'stade-bernabau', name: 'Stade Bernabau', x: 1375, y: 680, mapLabel: '46' },
    ],
};
