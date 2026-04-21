/**
 * Optional entrypoint: `node server/index.js` loads the same HTTP app as `node server.js`.
 * When routes are extracted to `createApp()`, listening will move here and root `server.js` will re-export this module only.
 */
import '../server.js';
