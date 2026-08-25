export function createAdminRouteController({ routeNames, onRefresh = () => {}, onNavigatePublic = () => {}, onAnnounce = () => {} } = {}) {
    if (!routeNames?.PNJ_NEW || !routeNames?.PNJ_EDIT || !routeNames?.PNJS) throw new TypeError('routeNames requis');
    let previousIdentity = null;
    const transition = ({ routeName, status, role, uid } = {}) => {
        const identity = `${status || ''}:${role || ''}:${uid || ''}`;
        const changed = identity !== previousIdentity;
        previousIdentity = identity;
        if (routeName === routeNames.PNJ_NEW || routeName === routeNames.PNJ_EDIT
            || routeName === routeNames.ENQUETE_NEW || routeName === routeNames.ENQUETE_EDIT) {
            if (status === 'gm' && role === 'mj' && typeof uid === 'string' && uid.length > 0) {
                onRefresh();
                return 'refresh-admin';
            }
            if (['checking', 'signing-in', 'signing-out'].includes(status)) {
                onRefresh();
                return 'refresh-checking';
            }
            onNavigatePublic();
            onAnnounce('Accès MJ indisponible : la liste publique est affichée.');
            return 'navigate-public';
        }
        if (routeName === routeNames.PNJ && changed) {
            onRefresh();
            return 'refresh-detail';
        }
        if (routeName === routeNames.ENQUETES && changed) {
            onRefresh();
            return 'refresh-enquetes';
        }
        return 'noop';
    };
    return Object.freeze({ transition, inspect: () => Object.freeze({ previousIdentity }) });
}
