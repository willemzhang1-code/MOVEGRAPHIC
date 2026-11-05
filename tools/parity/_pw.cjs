// Resolves Playwright from web/node_modules (devDependency) or a global install.
const path = require('path');
module.exports = function playwright() {
  try {
    return require(require.resolve('playwright', { paths: [path.join(__dirname, '../../web')] }));
  } catch {
    return require('playwright');
  }
};
