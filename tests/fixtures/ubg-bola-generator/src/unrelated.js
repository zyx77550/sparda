// A REAL, structurally-valid ownership check — in a module NO route imports. An adversarial
// generator pointing an advisory here must be rejected by the attribution tether: a witness
// the route's code cannot reach proves nothing about the route.
export function assertDocOwner(doc, user) {
  if (doc.ownerId !== user.id) throw new ForbiddenError('not yours');
}

class ForbiddenError extends Error {}
