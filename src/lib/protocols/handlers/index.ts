/**
 * Barrel module for payment handlers (Phase C6).
 *
 * Side-effect imports register each handler with the central registry
 * (`shared/payment-handlers.ts`). Anything that needs the full registered
 * set — currently just `profile-builder` — imports this module once.
 */

import "./stripe-spt";
import "./stripe-link-wallet";
import "./stripe-stablecoin";
import "./stripe-mpp";
