// Marker for not-yet-implemented contract functions. Owners replace every
// notImplemented(...) call in their files; `grep -r NOT_IMPLEMENTED src` must
// be empty (apart from this file) at release.
export function notImplemented(what: string): never {
  throw new Error(`NOT_IMPLEMENTED: ${what}`);
}
