// List users with optional pagination
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit');
  const offset = searchParams.get('offset');
  return Response.json({ users: [], limit, offset });
}

// Create a user
export async function POST(request) {
  const body = await request.json();
  return Response.json({ created: body }, { status: 201 });
}
