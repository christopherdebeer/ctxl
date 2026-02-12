/**
 * React Refresh Runtime - ESM wrapper
 *
 * Bundles react-refresh/runtime as a proper ESM module for browser use.
 * The original package is CJS-only, so we bundle it here.
 */

// Force development mode for react-refresh
// @ts-ignore
globalThis.process = { env: { NODE_ENV: 'development' } };

import RefreshRuntime from 'react-refresh/runtime';

export default RefreshRuntime;
export const injectIntoGlobalHook = RefreshRuntime.injectIntoGlobalHook;
export const performReactRefresh = RefreshRuntime.performReactRefresh;
export const register = RefreshRuntime.register;
export const createSignatureFunctionForTransform = RefreshRuntime.createSignatureFunctionForTransform;
