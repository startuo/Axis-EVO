// Share only the pending bootstrap, never an indefinitely cached authorization.
// A StrictMode cleanup must not cancel another mount's initialization.
export function createSessionInitializer<T>(initialize: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(initialize).finally(() => { pending = undefined; });
    }
    return pending;
  };
}
