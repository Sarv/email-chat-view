/**
 * Entry of the mobile bundle (`pnpm build:mobile`). Boots on load; everything
 * it runs lives in, and is tested through, `host.tsx`.
 */
import { bootMobileHost } from './host.js';

bootMobileHost(window);
