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

    const tileLayer = L.tileLayer(`tiles/${mapId}/{z}/{x}/{y}.webp`, {
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
    let measureOutline = null;
    let measureLine = null;
    let tempLine = null;
    let isDrawing = false;
    let isFinalized = false;

    const measureBtn = document.getElementById('measure-btn');
    const measurePanel = document.getElementById('measure-panel');
    const measureCloseBtn = document.getElementById('measure-close-btn');
    const measureClearBtn = document.getElementById('measure-clear-btn');
    const measureShareBtn = document.getElementById('measure-share-btn');
    const measureStatus = document.getElementById('measure-status');
    const measurePreview = document.getElementById('measure-preview');
    const measurePreviewImage = document.getElementById('measure-preview-image');
    const measurePreviewClose = document.getElementById('measure-preview-close');
    const measureDownloadLink = document.getElementById('measure-download-link');
    const measureNativeShareBtn = document.getElementById('measure-native-share-btn');
    const measureDistNum = document.getElementById('measure-dist-num');
    const travelWalk = document.getElementById('travel-time-walk');
    const travelRide = document.getElementById('travel-time-ride');
    const travelBarge = document.getElementById('travel-time-barge');
    let previewBlob = null;
    let previewFilename = '';
    let previewUrl = null;

    function toggleMeasure() {
        if (!isMeasureActive) {
            isMeasureActive = true;
            measureBtn.classList.add('active');
            measurePanel.style.display = 'block';
            if (isFinalized) measureStatus.textContent = 'Trajet terminé. La carte peut être déplacée.';
            else startDrawing();
        } else {
            deactivateMeasure();
        }
    }

    function startDrawing() {
        if (isDrawing) return;
        isDrawing = true;
        document.getElementById('map-container').classList.add('measure-mode-active');
        map.doubleClickZoom.disable();
        map.on('click', onMapClick);
        map.on('mousemove', onMapMouseMove);
        map.on('dblclick', onMapDblClick);
        map.on('contextmenu', onMapContextMenu);
    }

    function stopDrawing() {
        if (!isDrawing) return;
        isDrawing = false;
        document.getElementById('map-container').classList.remove('measure-mode-active');
        map.doubleClickZoom.enable();
        map.off('click', onMapClick);
        map.off('mousemove', onMapMouseMove);
        map.off('dblclick', onMapDblClick);
        map.off('contextmenu', onMapContextMenu);
    }

    function deactivateMeasure() {
        isMeasureActive = false;
        measureBtn.classList.remove('active');
        measurePanel.style.display = 'none';
        stopDrawing();
        if (!isFinalized) clearMeasure();
    }

    function onMapClick(e) {
        measureStatus.textContent = '';
        const latlng = e.latlng;
        measurePoints.push(latlng);
        
        const marker = L.circleMarker(latlng, {
            radius: 7,
            color: '#f14242',
            fillColor: '#fff5e8',
            fillOpacity: 1,
            weight: 3,
            interactive: false
        }).addTo(map);
        measureMarkers.push(marker);
        
        if (measureLine) {
            measureOutline.setLatLngs(measurePoints);
            measureLine.setLatLngs(measurePoints);
        } else {
            measureOutline = L.polyline(measurePoints, {
                color: '#2d0808',
                weight: 9,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false
            }).addTo(map);
            measureLine = L.polyline(measurePoints, {
                color: '#f14242',
                weight: 5,
                lineCap: 'round',
                lineJoin: 'round',
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
                color: '#f14242',
                opacity: 0.8,
                weight: 4,
                dashArray: '8, 6',
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
        if (measurePoints.length < 2) {
            measureStatus.textContent = 'Ajoute au moins deux points pour terminer le trajet.';
            return;
        }
        isFinalized = true;
        stopDrawing();
        if (tempLine) {
            map.removeLayer(tempLine);
            tempLine = null;
        }
        updateCalculations(measurePoints);
        measureShareBtn.disabled = false;
        measureStatus.textContent = 'Trajet terminé. La carte peut être déplacée.';
    }

    function clearMeasure() {
        measureMarkers.forEach(m => map.removeLayer(m));
        measureMarkers = [];
        
        if (measureOutline) {
            map.removeLayer(measureOutline);
            measureOutline = null;
        }
        if (measureLine) {
            map.removeLayer(measureLine);
            measureLine = null;
        }
        if (tempLine) {
            map.removeLayer(tempLine);
            tempLine = null;
        }
        
        measurePoints = [];
        isFinalized = false;
        measureShareBtn.disabled = true;
        measureStatus.textContent = '';
        updateCalculations([]);
        if (isMeasureActive) startDrawing();
    }

    async function createRouteImage(points) {
        // Leaflet affiche des tuiles <img> locales : on compose la vue courante
        // avec le trajet dans un canvas, sans dépendance de capture DOM.
        if (tileLayer.isLoading()) {
            await new Promise(resolve => {
                const finish = () => {
                    clearTimeout(timeout);
                    tileLayer.off('load', finish);
                    resolve();
                };
                const timeout = setTimeout(finish, 5000);
                tileLayer.on('load', finish);
            });
        }

        const mapRect = map.getContainer().getBoundingClientRect();
        const cornerA = map.latLngToContainerPoint(bounds[0]);
        const cornerB = map.latLngToContainerPoint(bounds[1]);
        const cropLeft = Math.max(0, Math.floor(Math.min(cornerA.x, cornerB.x)));
        const cropTop = Math.max(0, Math.floor(Math.min(cornerA.y, cornerB.y)));
        const cropRight = Math.min(mapRect.width, Math.ceil(Math.max(cornerA.x, cornerB.x)));
        const cropBottom = Math.min(mapRect.height, Math.ceil(Math.max(cornerA.y, cornerB.y)));
        const width = Math.round(cropRight - cropLeft);
        const mapHeight = Math.round(cropBottom - cropTop);
        if (width <= 0 || mapHeight <= 0) throw new Error('Capture de la carte impossible.');
        const footerHeight = 160;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, 4096 / width, 4096 / (mapHeight + footerHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round((mapHeight + footerHeight) * pixelRatio);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Capture de la carte impossible.');
        ctx.scale(pixelRatio, pixelRatio);
        ctx.fillStyle = '#07070d';
        ctx.fillRect(0, 0, width, mapHeight);

        const tiles = [...tileLayer.getContainer().querySelectorAll('img.leaflet-tile-loaded')]
            .filter(img => img.complete && img.naturalWidth > 0);
        if (tiles.length === 0) throw new Error('Les tuiles de la carte ne sont pas encore chargées.');
        for (const tile of tiles) {
            const rect = tile.getBoundingClientRect();
            if (rect.right <= mapRect.left || rect.left >= mapRect.right ||
                rect.bottom <= mapRect.top || rect.top >= mapRect.bottom) continue;
            ctx.drawImage(tile, rect.left - mapRect.left - cropLeft, rect.top - mapRect.top - cropTop, rect.width, rect.height);
        }

        const screenPoints = points.map(point => {
            const screenPoint = map.latLngToContainerPoint(point);
            return { x: screenPoint.x - cropLeft, y: screenPoint.y - cropTop };
        });
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const [color, lineWidth] of [['#2d0808', 9], ['#f14242', 5]]) {
            ctx.beginPath();
            screenPoints.forEach((point, index) => {
                if (index === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        }
        for (const point of screenPoints) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = '#fff5e8';
            ctx.fill();
            ctx.strokeStyle = '#f14242';
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        const distance = calculateDistance(points);
        ctx.fillStyle = '#101018';
        ctx.fillRect(0, mapHeight, width, footerHeight);
        ctx.fillStyle = '#f14242';
        ctx.fillRect(0, mapHeight, width, 4);
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#e4c76b';
        ctx.font = '600 17px Cinzel, Georgia, serif';
        ctx.fillText(config.name, 18, mapHeight + 17, width - 36);
        ctx.fillStyle = '#fff5e8';
        ctx.font = '700 30px Cinzel, Georgia, serif';
        ctx.fillText(`${(Math.round(distance * 10) / 10).toLocaleString('fr-FR')} milles`, 18, mapHeight + 49, width - 36);
        ctx.fillStyle = '#574b45';
        ctx.fillRect(18, mapHeight + 96, width - 36, 1);
        const travelTimes = [
            ['À pied', formatDays(distance / 20)],
            ['À cheval', formatDays(distance / 30)],
            ['En péniche', formatDays(distance / 25)]
        ];
        travelTimes.forEach(([label, duration], index) => {
            const x = 18 + index * (width - 36) / 3;
            const columnWidth = (width - 36) / 3 - 6;
            ctx.fillStyle = '#b8aa99';
            ctx.font = '14px Arial, sans-serif';
            ctx.fillText(label, x, mapHeight + 108, columnWidth);
            ctx.fillStyle = '#e4c76b';
            ctx.font = '600 15px Arial, sans-serif';
            ctx.fillText(duration, x, mapHeight + 130, columnWidth);
        });

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Création de l’image impossible.');
        return blob;
    }

    async function shareMeasure() {
        if (!isFinalized || measureShareBtn.disabled) return;
        measureShareBtn.disabled = true;
        measureStatus.textContent = 'Création de l’image…';
        try {
            const blob = await createRouteImage([...measurePoints]);
            const filename = `trajet-${mapId}-${new Date().toISOString().slice(0, 10)}.png`;
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewBlob = blob;
            previewFilename = filename;
            previewUrl = URL.createObjectURL(blob);
            measurePreviewImage.src = previewUrl;
            measureDownloadLink.href = previewUrl;
            measureDownloadLink.download = filename;
            measureNativeShareBtn.hidden = !(
                window.matchMedia('(pointer: coarse)').matches &&
                navigator.share && navigator.canShare && window.File &&
                navigator.canShare({ files: [new window.File([blob], filename, { type: 'image/png' })] })
            );
            measurePreview.showModal();
            measureStatus.textContent = 'Image prête à partager.';
        } catch (error) {
            measureStatus.textContent = error.message || 'La capture a échoué.';
        } finally {
            measureShareBtn.disabled = !isFinalized;
        }
    }

    async function sharePreview() {
        if (!previewBlob) return;
        try {
            const file = new window.File([previewBlob], previewFilename, { type: 'image/png' });
            await navigator.share({ files: [file], title: config.name });
            measureStatus.textContent = 'Image partagée.';
            measurePreview.close();
        } catch (error) {
            if (error.name !== 'AbortError') measureStatus.textContent = 'Partage indisponible. Télécharge le PNG.';
        }
    }

    if (measureBtn) measureBtn.addEventListener('click', toggleMeasure);
    if (measureCloseBtn) measureCloseBtn.addEventListener('click', deactivateMeasure);
    if (measureClearBtn) measureClearBtn.addEventListener('click', clearMeasure);
    if (measureShareBtn) measureShareBtn.addEventListener('click', shareMeasure);
    if (measurePreviewClose) measurePreviewClose.addEventListener('click', () => measurePreview.close());
    if (measureNativeShareBtn) measureNativeShareBtn.addEventListener('click', sharePreview);
}
