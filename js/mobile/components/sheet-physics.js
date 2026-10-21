const CLOSE_DISTANCE = 80;
const VELOCITY_WINDOW_MS = 100;
const EXIT_MIN_MS = 120;
const EXIT_MAX_MS = 280;

/** Distance (px) que le doigt parcourrait encore en décélérant à partir de `velocity` (px/s). */
export function project(velocity, rate = 0.998) {
    return (velocity / 1000) * rate / (1 - rate);
}

/** Résistance élastique : déplacement affiché pour un dépassement `overshoot`, borné par `dimension`. */
export function rubberband(overshoot, dimension, c = 0.55) {
    if (!overshoot) return 0;
    return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
}

/** Vitesse verticale (px/s) sur les 100 ms précédant le dernier échantillon `{ t (ms), y (px) }`. */
export function velocityFrom(samples) {
    if (!Array.isArray(samples) || samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    const first = samples.find(sample => sample.t >= last.t - VELOCITY_WINDOW_MS);
    if (!first || first === last) return 0;
    const span = last.t - first.t;
    return span > 0 ? (last.y - first.y) / span * 1000 : 0;
}

/** Le volet se ferme si la position projetée dépasse le seuil (un quart de la hauteur, au moins 80 px). */
export function shouldDismiss({ offset, velocity, height }) {
    const threshold = height > 0 ? Math.max(CLOSE_DISTANCE, height * 0.25) : CLOSE_DISTANCE;
    return offset + project(velocity) > threshold;
}

/** Durée (ms) de la sortie pour poursuivre à la vitesse du doigt, bornée à 120–280 ms. */
export function exitDuration(remaining, velocity) {
    const ms = velocity > 0 ? remaining / velocity * 1000 : EXIT_MAX_MS;
    return Math.round(Math.min(EXIT_MAX_MS, Math.max(EXIT_MIN_MS, ms)));
}
