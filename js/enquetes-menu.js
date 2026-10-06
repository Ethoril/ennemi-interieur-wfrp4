export function createActionMenu({ documentRef: d, label, items }) {
    const element = d.createElement('div');
    element.className = 'enq-action-menu';
    const trigger = d.createElement('button');
    trigger.type = 'button';
    trigger.className = 'enq-icon-button';
    trigger.textContent = '⋯';
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    const menu = d.createElement('div');
    menu.className = 'enq-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    menu.hidden = true;
    const buttons = [];
    let focusTarget = trigger;
    const outside = event => { if (!element.contains(event.target) && !focusTarget?.contains(event.target)) close(false); };
    function close(restore = true) {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        focusTarget?.setAttribute('aria-expanded', 'false');
        d.removeEventListener('click', outside);
        if (restore) focusTarget?.focus();
    }
    function open(anchor = trigger) {
        focusTarget = anchor;
        focusTarget?.setAttribute('aria-haspopup', 'menu');
        focusTarget?.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        buttons[0]?.focus();
        d.addEventListener('click', outside);
    }
    for (const item of items.filter(item => !item.hidden)) {
        const button = d.createElement('button');
        button.type = 'button';
        button.className = 'enq-button enq-button--' + (item.variant || 'quiet');
        button.textContent = item.label;
        button.setAttribute('role', 'menuitem');
        button.tabIndex = -1;
        button.addEventListener('click', () => { close(); item.action(); });
        buttons.push(button);
        menu.append(button);
    }
    trigger.addEventListener('click', () => { if (menu.hidden) open(); else close(); });
    trigger.addEventListener('keydown', event => {
        if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); open(); }
    });
    element.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const i = buttons.indexOf(d.activeElement);
            buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
                (i + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        } else if (event.key === 'Tab') close();
    });
    element.append(trigger, menu);
    return { element, close, open };
}
