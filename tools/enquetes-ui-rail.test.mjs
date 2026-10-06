import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './lib/enquetes-ui-fixture.mjs';
import { flush } from './lib/enquetes-test-dom.mjs';
test('rail retains space navigation, toggle filters, current card and trash',async()=>{
    const f=await fixture();
    assert.equal(f.button('Qui finance la Main Pourpre ?').getAttribute('aria-current'),'true');
    f.button('En pause 1').click();assert.ok(f.button('L’héritage de Kastor Lieberung'));assert.equal(f.button('Qui finance la Main Pourpre ?'),undefined);
    f.button('En pause 1').click();assert.ok(f.button('Qui finance la Main Pourpre ?'));
    f.button('Carnet 2').click();assert.ok(f.button('Le sceau'));
    f.d.dispatch('keydown',{key:'/'});assert.equal(f.d.activeElement,f.container.querySelector('input'));
    f.button('Corbeille').click();await flush();assert.ok(f.button('Retour aux dossiers'));
    f.button('Retour aux dossiers').click();assert.ok(f.button('Qui finance la Main Pourpre ?'));f.view.unmount();
});
