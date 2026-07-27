// The REAL ownership check — structurally verifiable (`ifAssertsOwnership` passes on the
// compare+deny below), but reached from the route only through a variable indirection the
// static resolver does not follow. The generator's job is to POINT here; the verifier's job
// is to re-prove it.
export function assertRowOwner(row, user) {
  if (row.ownerId !== user.id) throw new ForbiddenError('not yours');
}

class ForbiddenError extends Error {}
