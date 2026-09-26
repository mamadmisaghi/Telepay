// Preserve Pino's browser implementation while exposing its CommonJS properties
// as ESM named exports for Privy's prebundled routes module.
import pino from 'pino/browser.js';
export const levels=pino.levels;
export {pino};
export default pino;
