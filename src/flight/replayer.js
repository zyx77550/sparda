// flight/replayer.js — re-fly one recorded request against the real code.
// The app runs in-process on an ephemeral port; every nondeterminism point is
// fed the recorded value by the FlightBox; the response must come out
// byte-equal (JSON-canonical when both sides parse as JSON). The verdict is
// three-part and all three must hold for a match:
//   1. the response is identical,
//   2. no divergence was raised (same questions, same order),
//   3. every tap was consumed (the code didn't silently skip a step).
import http from 'node:http';

export async function replayFlight(app, flight, box, { lenient = false } = {}) {
  const store = box.makeReplayStore(flight, { lenient });

  const server = http.createServer((req, res) => {
    box.runWith(store, () => app(req, res));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  let actual;
  try {
    const { request } = flight;
    const hasBody = request.body !== null && request.method !== 'GET';
    // raw http.request on purpose: the box may have global fetch patched, the
    // replayer's own client must be immune to every virtualization layer
    actual = await rawRequest({
      port,
      method: request.method,
      path: request.url,
      headers: hasBody
        ? { 'content-type': request.headers['content-type'] || 'application/json' }
        : {},
      body: hasBody ? JSON.stringify(request.body) : null,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const expected = { status: flight.response.status, body: flight.response.body };
  const bodyMatch = jsonOrRawEqual(expected.body, actual.body);
  const statusMatch = expected.status === actual.status;
  const leftover = [...store.queues.entries()]
    .filter(([, q]) => q.length)
    .map(([kind, q]) => ({ kind, unconsumed: q.length }));

  return {
    match:
      statusMatch && bodyMatch && store.divergences.length === 0 && leftover.length === 0,
    statusMatch,
    bodyMatch,
    expected,
    actual,
    divergences: store.divergences,
    relabels: store.relabels ?? [],
    leftover,
  };
}

export function rawRequest({ port, method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// byte-equality with one mercy: JSON key order is not meaning
function jsonOrRawEqual(a, b) {
  if (a === b) return true;
  try {
    return canonical(JSON.parse(a)) === canonical(JSON.parse(b));
  } catch {
    return false;
  }
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}
