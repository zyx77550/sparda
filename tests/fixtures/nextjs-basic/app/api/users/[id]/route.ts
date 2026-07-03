// Fetch one user by id
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json({ id });
}

// Delete a user permanently
export const DELETE = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  await params;
  return new Response(null, { status: 204 });
};
