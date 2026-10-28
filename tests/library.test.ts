import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Executa o serviço real com fronteiras nativas simuladas; não carrega Expo no Node.
function setup(copyFailure = false) {
  const events: string[] = [];
  let copied = false;
  class Directory {
    uri = 'file:///private/library';
    exists = true;
    create() {}
    delete() { events.push('delete-private'); }
    constructor(..._parts: unknown[]) {}
  }
  class File {
    uri: string;
    exists = true;
    size = 100;
    constructor(parent: string | Directory, name?: string) {
      this.uri = typeof parent === 'string' ? parent : `${parent.uri}/${name}`;
    }
    async copy() {
      events.push('copy-start');
      await new Promise(resolve => setTimeout(resolve, 5));
      if (copyFailure) throw new Error('Missing READ permission');
      copied = true;
      events.push('copy-finish');
    }
    open() {
      assert.ok(copied, 'o arquivo só pode ser aberto após a cópia');
      return { close() {}, offset: 0, readBytesSync() { return new Uint8Array(); } };
    }
    async write() { events.push('write'); }
    delete() { events.push('delete-original'); }
  }
  const modules: Record<string, unknown> = {
    'expo-file-system': { Directory, File, Paths: { document: 'private' } },
    'expo-document-picker': { async getDocumentAsync(options: {copyToCacheDirectory: boolean}) {
      assert.equal(options.copyToCacheDirectory, false);
      return { canceled: false, assets: [{ uri: 'content://downloads/42', name: 'teste.cbz', size: 100 }] };
    } },
    'expo-crypto': { randomUUID: () => 'test-id' },
    './zip': { indexZip: () => [{name: '1.png'}], extractPage: () => new Uint8Array([1]) },
  };
  const module = { exports: {} as { importBook: (db: unknown) => Promise<boolean> } };
  const source = readFileSync('src/services/library.ts', 'utf8');
  const {outputText} = ts.transpileModule(source, {compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }});
  runInNewContext(outputText, {module, exports: module.exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Módulo inesperado: ${name}`);
    return modules[name];
  }, setTimeout});
  return {events, importBook: module.exports.importBook};
}
test('importa da URI autorizada, aguarda a cópia e preserva o original', async () => {
  const {events, importBook} = setup();
  assert.equal(await importBook({async runAsync() {events.push('insert');}}), true);
  assert.deepEqual(events, ['copy-start', 'copy-finish', 'write', 'write', 'insert']);
});
test('falha de cópia é propagada e só remove a pasta privada incompleta', async () => {
  const {events, importBook} = setup(true);
  await assert.rejects(importBook({}), /Missing READ permission/);
  assert.deepEqual(events, ['copy-start', 'delete-private']);
});
