import * as mock from '../mocks/vscodeMock';

const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (this: any, id: string) {
  if (id === 'vscode') {
    return mock;
  }
  return originalRequire.apply(this, arguments);
};
