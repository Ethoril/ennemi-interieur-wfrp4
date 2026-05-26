const MAPS_CONFIG = {
    'empire': {
        name: "Carte de l'Empire",
        refW: 8192,
        refH: 8192,
        scale: 4.8,
    },
    'vieux-monde': {
        name: 'Carte du Vieux Monde',
        refW: 8192,
        refH: 7181,
        scale: 8.0,
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

    // --- OUTIL DE MESURE DE DISTANCE (RÈGLE) ---
    let isMeasureActive = false;
    let measurePoints = [];
    let measureMarkers = [];
    let measureLine = null;
    let tempLine = null;

    const measureBtn = document.getElementById('measure-btn');
    const measurePanel = document.getElementById('measure-panel');
    const measureCloseBtn = document.getElementById('measure-close-btn');
    const measureClearBtn = document.getElementById('measure-clear-btn');
    const measureDistNum = document.getElementById('measure-dist-num');
    const travelWalk = document.getElementById('travel-time-walk');
    const travelRide = document.getElementById('travel-time-ride');
    const travelBarge = document.getElementById('travel-time-barge');

    function toggleMeasure() {
        isMeasureActive = !isMeasureActive;
        if (isMeasureActive) {
            measureBtn.classList.add('active');
            measurePanel.style.display = 'block';
            document.getElementById('map-container').classList.add('measure-mode-active');
            map.doubleClickZoom.disable();
            
            map.on('click', onMapClick);
            map.on('mousemove', onMapMouseMove);
            map.on('dblclick', onMapDblClick);
            map.on('contextmenu', onMapContextMenu);
        } else {
            deactivateMeasure();
        }
    }

    function deactivateMeasure() {
        isMeasureActive = false;
        measureBtn.classList.remove('active');
        measurePanel.style.display = 'none';
        document.getElementById('map-container').classList.remove('measure-mode-active');
        map.doubleClickZoom.enable();
        
        map.off('click', onMapClick);
        map.off('mousemove', onMapMouseMove);
        map.off('dblclick', onMapDblClick);
        map.off('contextmenu', onMapContextMenu);
        
        clearMeasure();
    }

    function onMapClick(e) {
        const latlng = e.latlng;
        measurePoints.push(latlng);
        
        const marker = L.circleMarker(latlng, {
            radius: 6,
            color: '#e4c76b', // var(--gold-bright)
            fillColor: '#07070d', // var(--bg-darkest)
            fillOpacity: 1,
            weight: 2,
            interactive: false
        }).addTo(map);
        measureMarkers.push(marker);
        
        if (measureLine) {
            measureLine.setLatLngs(measurePoints);
        } else {
            measureLine = L.polyline(measurePoints, {
                color: '#c9a84c', // var(--gold)
                weight: 3,
                dashArray: '5, 5',
                interactive: false
            }).addTo(map);
        }
        
        updateCalculations(measurePoints);
    }

    function onMapMouseMove(e) {
        if (measurePoints.length === 0) return;
        
        const lastPoint = measurePoints[measurePoints.length - 1];
        const currentLatLng = e.latlng;
        
        if (tempLine) {
            tempLine.setLatLngs([lastPoint, currentLatLng]);
        } else {
            tempLine = L.polyline([lastPoint, currentLatLng], {
                color: 'rgba(201, 168, 76, 0.5)',
                weight: 2,
                dashArray: '5, 5',
                interactive: false
            }).addTo(map);
        }
        
        const pointsWithTemp = [...measurePoints, currentLatLng];
        updateCalculations(pointsWithTemp);
    }

    function calculateDistance(points) {
        let total = 0;
        const scale = config.scale || 1.0;
        for (let i = 1; i < points.length; i++) {
            const p1 = points[i - 1];
            const p2 = points[i];
            const dx = (p2.lng - p1.lng) * scale;
            const dy = (p2.lat - p1.lat) * scale;
            total += Math.sqrt(dx * dx + dy * dy);
        }
        return total;
    }

    function formatDays(days) {
        if (days === 0) return "0 jour";
        const rounded = Math.round(days * 10) / 10;
        return `${rounded.toLocaleString('fr-FR')} ${rounded <= 1 ? 'jour' : 'jours'}`;
    }

    function updateCalculations(points) {
        const distance = calculateDistance(points);
        const roundedDist = Math.round(distance * 10) / 10;
        measureDistNum.textContent = roundedDist.toLocaleString('fr-FR');
        
        travelWalk.textContent = formatDays(distance / 20);
        travelRide.textContent = formatDays(distance / 30);
        travelBarge.textContent = formatDays(distance / 25);
    }

    function onMapDblClick(e) {
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
        }
        clearMeasure();
    }

    function onMapContextMenu(e) {
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
        }
        clearMeasure();
    }

    function clearMeasure() {
        measureMarkers.forEach(m => map.removeLayer(m));
        measureMarkers = [];
        
        if (measureLine) {
            map.removeLayer(measureLine);
            measureLine = null;
        }
        if (tempLine) {
            map.removeLayer(tempLine);
            tempLine = null;
        }
        
        measurePoints = [];
        updateCalculations([]);
    }

    if (measureBtn) measureBtn.addEventListener('click', toggleMeasure);
    if (measureCloseBtn) measureCloseBtn.addEventListener('click', deactivateMeasure);
    if (measureClearBtn) measureClearBtn.addEventListener('click', clearMeasure);
}
