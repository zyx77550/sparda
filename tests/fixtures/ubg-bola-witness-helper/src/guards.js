// The imported form of the ownership helper — the compare+deny lives HERE, one module away
// from the route. The verifier must resolve this body through the import to clear O7.
export function assertOwnerOf(row, user) {
  if (row.ownerId !== user.id) throw new ForbiddenError('not yours');
}

class ForbiddenError extends Error {}
