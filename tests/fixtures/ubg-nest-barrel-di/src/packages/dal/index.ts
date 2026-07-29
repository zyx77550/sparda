// A workspace package entry point, and nothing else. This is what `@novu/dal` and
// `@novu/application-generic` actually are: sixty of these lines, zero class declarations.
// A resolver that looks for a class DECLARED here finds nothing and stops — silently,
// because an unresolved DI hop leaves no trace of its own.
export * from './repositories/order';
export * from './repositories/audit';
