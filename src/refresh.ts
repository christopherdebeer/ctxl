/**
 * React Refresh injection (regex-based, no Babel).
 *
 * Detects PascalCase component declarations and wraps the module
 * with $RefreshReg$ calls so React Refresh can track component identity.
 */
export function injectReactRefresh(code: string, filePath: string): string {
  // Match PascalCase names (must have lowercase after first cap to exclude ALL_CAPS constants)
  const componentRegex = /(?:export\s+(?:default\s+)?)?(?:function|const)\s+([A-Z][a-z][a-zA-Z0-9]*)/g;
  const components: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = componentRegex.exec(code)) !== null) {
    components.push(match[1]);
  }
  if (components.length === 0) return code;

  const registrations = components
    .map(name => `  window.$RefreshReg$(${name}, "${name}");`)
    .join("\n");

  return `
var prevRefreshReg = window.$RefreshReg$;
var prevRefreshSig = window.$RefreshSig$;
window.$RefreshReg$ = (type, id) => {
  window.__RUNTIME__.RefreshRuntime.register(type, "${filePath}" + " " + id);
};
window.$RefreshSig$ = window.__RUNTIME__.RefreshRuntime.createSignatureFunctionForTransform;

${code}

${registrations}

window.$RefreshReg$ = prevRefreshReg;
window.$RefreshSig$ = prevRefreshSig;
`;
}
