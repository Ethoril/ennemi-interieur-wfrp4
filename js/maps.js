const MAPS_CONFIG = {
    'empire': {
        name: "Carte de l'Empire",
        refW: 8192,
        refH: 8192,
    },
    'vieux-monde': {
        name: 'Carte du Vieux Monde',
        refW: 8192,
        refH: 7181,
    },
};

const MAX_ZOOM = 5;
const TILE_SIZE = 256;
const REF_ZOOM = Math.pow(2, MAX_ZOOM); // 32

const mapId = new URLSearchParams(location.search).get('map');
const config = MAPS_CONFIG[mapId];

if (!config) {
    document.getElementById('map-container').innerHTML =
        '<p style="color:var(--text-muted);padding:2rem;text-align:center">Carte introuvable.</p>';
} else {
    document.getElementById('map-title').textContent = config.name;

    // Custom CRS: y-axis points downward (matches image coordinates)
    const ImageCRS = L.extend({}, L.CRS.Simple, {
        transformation: new L.Transformation(1, 0, 1, 0),
    });

    const map = L.map('map-container', {
        crs: ImageCRS,
        maxZoom: MAX_ZOOM,
        minZoom: 0,
        zoomSnap: 0.5,
        zoomDelta: 0.5,
        maxBoundsViscosity: 1.0,
        attributionControl: false,
    });

    // Bounds in CRS units: [[y_min, x_min], [y_max, x_max]]
    const bounds = [
        [0, 0],
        [config.refH / REF_ZOOM, config.refW / REF_ZOOM],
    ];

    L.tileLayer(`tiles/${mapId}/{z}/{x}/{y}.webp`, {
        tileSize: TILE_SIZE,
        minZoom: 0,
        maxZoom: MAX_ZOOM,
        bounds: bounds,
        noWrap: true,
        keepBuffer: 2,
    }).addTo(map);

    map.setMaxBounds(bounds);
    map.fitBounds(bounds);
}
