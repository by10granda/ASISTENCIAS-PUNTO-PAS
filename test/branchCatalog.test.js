import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import { buildBranchNames, includesBranch } from '../src/branchCatalog.js';

test('usa solo las sucursales actuales y las agregadas al catalogo', () => {
  const workers = [{ branch: 'CALDERON' }, { branch: 'RINCON' }];
  assert.deepEqual(buildBranchNames(workers, [{ name: 'NUEVA' }]), ['CALDERON', 'NUEVA', 'RINCON']);
  assert.equal(buildBranchNames(workers, []).includes('ESMERALDAS'), false);
});

test('omite nombres vacios y duplicados sin alterar los nombres existentes', () => {
  const workers = [{ branch: 'CALDERON' }, { branch: 'CALDERON' }, { branch: '' }, {}];
  assert.deepEqual(buildBranchNames(workers, [{ name: 'CALDERON' }, { name: '  ' }]), ['CALDERON']);
});

test('detecta nuevas sucursales duplicadas sin distinguir mayusculas', () => {
  assert.equal(includesBranch(['CALDERON'], ' calderon '), true);
  assert.equal(includesBranch(['CALDERON'], 'NUEVA'), false);
});

test('una nueva sucursal sigue disponible aunque no tenga trabajadores', () => {
  assert.deepEqual(buildBranchNames([], [{ name: 'NUEVA' }]), ['NUEVA']);
});

test('el formulario muestra un selector y conserva la sucursal al editar', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../src/views/workers/form.ejs', import.meta.url)), {
    title: 'Editar trabajador', path: '/trabajadores/1/edit', errors: [],
    worker: { id: '1', branch: 'CALDERON' }, action: '/trabajadores/1', branches: ['CALDERON', 'NUEVA']
  });
  assert.match(html, /<select required name="branch">/);
  assert.match(html, /value="CALDERON" selected/);
  assert.match(html, /action="\/trabajadores\/branches"/);
  assert.doesNotMatch(html, /<input[^>]*name="branch"/);
});
