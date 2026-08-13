import { legacyDisabledHandler } from './_verify/legacy-disabled.js';

export const config = { schedule: '0 * * * *' };
export const handler = legacyDisabledHandler;
