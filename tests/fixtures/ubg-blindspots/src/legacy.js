// A handler whose body SPARDA cannot read: it's dynamically built at load time.
// Exported as an opaque value, not a function declaration → fn:null in the graph.
export const legacyHandler = buildHandler('legacy');

function buildHandler(name) {
  // returns a closure the static eye can't follow — deliberately opaque
  return globalThis.__handlers?.[name];
}
