'use strict';
// Bootstrap for the Electron main process. There is no build step: tsx
// registers an on-the-fly TypeScript transform (esbuild, standalone binary,
// no Electron ABI involved) and the real entry point is main.ts.
require('tsx/cjs');
require('./main.ts');
