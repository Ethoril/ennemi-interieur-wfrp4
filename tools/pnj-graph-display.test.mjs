import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphDisplay } from '../js/pnj-graph-display.js';

class Element {
  constructor() { this.listeners = {}; this.classList = { values: new Set(), toggle: (name, on) => on ? this.classList.values.add(name) : this.classList.values.delete(name), remove: (name) => this.classList.values.delete(name) }; this.attrs = {}; this.dataset = {}; this.hidden = false; this.textContent = ''; this.isConnected = true; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  removeEventListener(name) { delete this.listeners[name]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return this.attrs[name]; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.listeners.click?.({ target: this }); }
}

function setup() {
  const workspace = new Element();
  const toggle = new Element();
  const filter = new Element();
  const badge = new Element();
  const drawer = new Element();
  drawer.querySelector = () => badge;
  const documentRef = new Element();
  documentRef.ownerDocument = documentRef;
  documentRef.activeElement = new Element();
  documentRef.activeElement.ownerDocument = documentRef;
  for (const el of [workspace, toggle, filter, badge, drawer]) el.ownerDocument = documentRef;
  documentRef.getElementById = (id) => ({ 'pnj-workspace': workspace, 'pnj-fullscreen-toggle': toggle, 'pnj-group-filter-drawer': drawer, 'filter-groupe': filter })[id];
  documentRef.querySelectorAll = () => [];
  return { documentRef, workspace, toggle, filter, badge, drawer };
}

test('fallback fullscreen restores focus, resizes, and exits on Escape', async () => {
  const dom = setup();
  const originalFocus = dom.documentRef.activeElement;
  let resizes = 0;
  let beforeExit = 0;
  const display = createGraphDisplay({ documentRef: dom.documentRef, onResize: () => resizes++, onBeforeExit: () => beforeExit++ });
  await display.enter();
  assert.equal(display.isFullscreen(), true);
  assert.equal(dom.workspace.classList.values.has('pnj-workspace-fullscreen'), true);
  assert.equal(dom.toggle.getAttribute('aria-pressed'), 'true');

  let prevented = false;
  dom.documentRef.listeners.keydown({ key: 'Escape', target: { matches: () => true }, preventDefault: () => { prevented = true; } });
  assert.equal(display.isFullscreen(), true, 'Escape in an edit field is left to the field');
  dom.documentRef.listeners.keydown({ key: 'Escape', target: dom.toggle, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(display.isFullscreen(), false);
  assert.equal(dom.documentRef.activeElement, originalFocus);
  assert.equal(beforeExit, 1);
  assert.equal(resizes, 2);
});

test('group drawer exposes selected group count only when groups exist', () => {
  const dom = setup();
  const display = createGraphDisplay({ documentRef: dom.documentRef });
  display.updateGroups({ availableCount: 4, selectedCount: 2 });
  assert.equal(dom.drawer.hidden, false);
  assert.equal(dom.filter.hidden, false);
  assert.equal(dom.badge.textContent, '2');
  assert.equal(dom.badge.getAttribute('aria-label'), '2 groupes sélectionnés');
  display.updateGroups({ availableCount: 0, selectedCount: 0 });
  assert.equal(dom.drawer.hidden, true);
  display.destroy();
});

test('native fullscreen cleans up outside focus and scrolling on exit', async () => {
  const dom = setup();
  const body = { style: { overflow: 'auto' }, children: [] };
  const outside = { inert: false, tagName: 'NAV' };
  const alreadyInert = { inert: true, tagName: 'FOOTER' };
  body.children = [dom.workspace, outside, alreadyInert];
  dom.workspace.parentElement = body;
  dom.documentRef.body = body;
  dom.workspace.requestFullscreen = async () => {
    dom.documentRef.fullscreenElement = dom.workspace;
    dom.documentRef.listeners.fullscreenchange();
  };
  dom.documentRef.exitFullscreen = async () => {
    dom.documentRef.fullscreenElement = null;
    dom.documentRef.listeners.fullscreenchange();
  };
  const originalFocus = dom.documentRef.activeElement;
  const display = createGraphDisplay({ documentRef: dom.documentRef });
  await display.enter();
  assert.equal(body.style.overflow, 'hidden');
  assert.equal(outside.inert, true);
  await display.exit();
  assert.equal(display.isFullscreen(), false);
  assert.equal(dom.workspace.classList.values.has('pnj-workspace-fullscreen'), false);
  assert.equal(body.style.overflow, 'auto');
  assert.equal(outside.inert, false);
  assert.equal(alreadyInert.inert, true);
  assert.equal(dom.documentRef.activeElement, originalFocus);
});

test('rejected native request falls back; Escape consumed by the dossier or a dialog does not exit', async () => {
  const dom = setup();
  dom.workspace.requestFullscreen = async () => { throw new Error('Unsupported'); };
  const display = createGraphDisplay({ documentRef: dom.documentRef });
  await display.enter();
  const escape = { key: 'Escape', target: dom.toggle, preventDefault() { throw new Error('Must not consume'); } };
  dom.documentRef.listeners.keydown({ ...escape, defaultPrevented: true });
  assert.equal(display.isFullscreen(), true);
  dom.documentRef.querySelectorAll = () => [{ open: true }];
  dom.documentRef.listeners.keydown(escape);
  assert.equal(display.isFullscreen(), true);
  await display.exit();
  assert.equal(display.isFullscreen(), false);
});

test('cancelling an unfinished native request prevents fullscreen from being reopened', async () => {
  const dom = setup();
  let resolveRequest;
  let requests = 0;
  dom.workspace.requestFullscreen = () => {
    requests++;
    return new Promise(resolve => { resolveRequest = resolve; });
  };
  dom.documentRef.exitFullscreen = async () => { dom.documentRef.fullscreenElement = null; };
  const display = createGraphDisplay({ documentRef: dom.documentRef });
  const entering = display.enter();
  await display.enter();
  assert.equal(requests, 1, 'Double clicks do not create duplicate requests');
  await display.exit();
  dom.documentRef.fullscreenElement = dom.workspace;
  resolveRequest();
  await entering;
  assert.equal(display.isFullscreen(), false);
  assert.equal(dom.workspace.classList.values.has('pnj-workspace-fullscreen'), false);
});
