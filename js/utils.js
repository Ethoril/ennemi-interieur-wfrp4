export const esc = s =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

export const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
