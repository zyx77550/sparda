// ubg/extract.js — the shared AST microscope.
// One module = one parse. parseModule() caches per-file facts (top-level
// functions, import map); scanFunction() walks a single function body and
// reports what it DOES: database reads/writes, external HTTP, filesystem
// touches, response shapes, auth signals, local calls. Framework extractors
// (express.js, nextjs.js) decide what is a route; this file only observes
// behavior. Everything is bounded and deterministic — source order in,
// source order out.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const MAX_EFFECTS = 40;
const MAX_RETURN_SHAPES = 10;
const MAX_CALLS = 30;

const SQL_VERBS = {
  select: { effectType: 'db_read', op: 'select' },
  insert: { effectType: 'db_write', op: 'insert' },
  update: { effectType: 'db_write', op: 'update' },
  delete: { effectType: 'db_write', op: 'delete' },
  upsert: { effectType: 'db_write', op: 'upsert' },
};
const SUPABASE_OPS = new Set(['select', 'insert', 'update', 'upsert', 'delete']);
// Kysely: the op names its own table (db.insertInto('t')), one op = one verb.
const KYSELY_OPS = {
  insertinto: 'insert',
  updatetable: 'update',
  deletefrom: 'delete',
  selectfrom: 'select',
  replaceinto: 'upsert',
  mergeinto: 'upsert',
};
// Active-record ORM ops, keyed by method name. Covers Mongoose (`User.create()`),
// TypeORM (`User.save()`/`repo.save()`), and Sequelize (`User.findAll()`/`destroy()`) —
// they share the `Model.op()` / `repository.op()` shape, so one table serves all three.
const MODEL_OPS = {
  // writes — inserts
  create: 'insert',
  insertmany: 'insert',
  bulkcreate: 'insert', // sequelize
  save: 'insert', // mongoose / typeorm
  insert: 'insert', // typeorm repository
  // writes — updates
  updateone: 'update',
  updatemany: 'update',
  replaceone: 'update',
  findbyidandupdate: 'update',
  findoneandupdate: 'update',
  findoneandreplace: 'update',
  increment: 'update', // sequelize / typeorm
  decrement: 'update',
  upsert: 'upsert',
  // writes — deletes
  deleteone: 'delete',
  deletemany: 'delete',
  findbyidanddelete: 'delete',
  findoneanddelete: 'delete',
  findbyidandremove: 'delete',
  remove: 'delete', // mongoose / typeorm
  destroy: 'delete', // sequelize
  softdelete: 'delete', // typeorm
  softremove: 'delete',
  // reads
  find: 'select',
  findall: 'select', // sequelize
  findone: 'select',
  findbyid: 'select',
  findbypk: 'select', // sequelize
  findby: 'select', // typeorm
  findoneby: 'select', // typeorm
  countdocuments: 'select',
  estimateddocumentcount: 'select',
  count: 'select',
  distinct: 'select',
  exists: 'select',
  paginate: 'select',
};
// A capitalized `.create()`/`.save()` receiver is usually an active-record MODEL — but in
// CQRS/DDD codebases it is just as often a COMMAND/QUERY factory (`GetWorkflowRunCommand
// .create(...)`), a DTO, or a handler, which construct an object and touch no database.
// These suffixes NEVER name a real ORM model, so excluding them removes phantom db_writes
// without any risk of hiding a real one (SOUNDNESS Direction 1 — a real write is never
// dropped, only over-approximation noise is). Measured: novu 612/636 db_writes were these.
// Deliberately excludes ambiguous nouns that CAN name a real model (`Event`, `Entity`,
// `Schema`, `Payload`) — dropping a real write is the one unforgivable error (SOUNDNESS
// Direction 1). Only DI/CQRS infra suffixes that never name an ORM model are listed.
const NON_MODEL_RECEIVER =
  /(command|query|usecase|handler|dto|response|request|mapper|factory|builder|module|controller|service|repository|guard|interceptor|pipe|filter|middleware|resolver|gateway|strategy|validator|serializer|exception|config)$/i;
// Drizzle: `db.insert(users).values(...)` / `db.update(users).set(...)` / `db.delete(users)`
// — the table is an IDENTIFIER (the schema object), not a string. Distinct from Kysely
// (which names the table in the method: insertInto) and supabase (.from('t')).
const DRIZZLE_OPS = { insert: 'insert', update: 'update', delete: 'delete' };
const PRISMA_OPS = {
  findmany: 'select',
  findunique: 'select',
  finduniqueorthrow: 'select', // the ...OrThrow reads are the ownership-scoping fetch
  findfirst: 'select',
  findfirstorthrow: 'select',
  count: 'select',
  aggregate: 'select',
  groupby: 'select',
  create: 'insert',
  createmany: 'insert',
  createmanyandreturn: 'insert',
  update: 'update',
  updatemany: 'update',
  upsert: 'upsert',
  delete: 'delete',
  deletemany: 'delete',
};
// TypeORM write verbs on a repository / entity-manager. Only fire when the RECEIVER is provably
// a repository (in ctx.repoTables) — a generic `.save()`/`.update()` on an unknown object never
// fires, so false positives stay near zero. Reads (find/findOne/count/…) are not here.
const TYPEORM_WRITE = {
  save: 'insert',
  insert: 'insert',
  upsert: 'insert',
  update: 'update',
  increment: 'update',
  decrement: 'update',
  delete: 'delete',
  remove: 'delete',
  softdelete: 'delete',
  softremove: 'delete',
  restore: 'update',
};

const FS_WRITE = new Set([
  'writefile',
  'writefilesync',
  'appendfile',
  'appendfilesync',
  'unlink',
  'unlinksync',
  'mkdir',
  'mkdirsync',
  'rm',
  'rmsync',
  'rename',
  'renamesync',
]);
const FS_READ = new Set([
  'readfile',
  'readfilesync',
  'readdir',
  'readdirsync',
  'stat',
  'statsync',
  'existssync',
]);
const HTTP_CLIENTS = new Set(['axios', 'got', 'ky', 'superagent', 'undici']);

// Innate immunity (PAMP table): vendor-SDK call shapes that ARE an irreversible external
// effect but wear no `fetch`/http-client skin (the SDK hides the network call). Extraction
// blind spot #1 in the audit: `stripe.charges.create()` charges a card, yet resolved to
// nothing, so O4 (irreversibility) never fired on real payment code. We can't enumerate every
// SDK — so, like the olfactory system, we recognize a small set of CONSERVED, highly-specific
// call SHAPES directly (combinatorial coding, not one receptor per molecule). Matched on the
// property path BELOW the (user-named) root, so the variable name is irrelevant; DB handlers
// above have already returned, so no double-count. Additive + write-only: it can only ever
// RAISE a finding (an observable http_call), never fabricate a false PROVEN — a stale catalog
// under-detects, it never lies. This is the deterministic, zero-LLM, zero-network innate layer;
// the adaptive layer (LLM-on-surprise → antibody) is a later brick that fills the long tail.
const EFFECT_SDK_PATHS = new Set([
  // Stripe — money movement, irreversible
  'charges.create',
  'paymentintents.create',
  'paymentintents.confirm',
  'paymentintents.capture',
  'refunds.create',
  'payouts.create',
  'transfers.create',
  'subscriptions.create',
  'subscriptions.cancel',
  'invoices.pay',
  'checkout.sessions.create',
  'paymentmethods.attach',
  // Twilio — SMS / voice, irreversible once sent
  'messages.create',
  'calls.create',
  // Resend / modern mail SDKs — the email leaves once sent
  'emails.send',
  'emails.create',
]);
// AWS SDK v3 & friends speak `client.send(new XCommand(...))` — the verb is a generic `.send`,
// but the COMMAND class in the argument names the effect unmistakably. Match the command name
// (lowercased) so the modern AWS style is not a blind spot the way v2 `s3.putObject()` isn't.
const EFFECT_SDK_COMMANDS = new Set([
  'putobjectcommand', // S3 write
  'deleteobjectcommand',
  'copyobjectcommand',
  'sendemailcommand', // SES
  'sendrawemailcommand',
  'sendtemplatedemailcommand',
  'sendmessagecommand', // SQS
  'sendmessagebatchcommand',
  'publishcommand', // SNS
  'publishbatchcommand',
  'invokecommand', // Lambda
  'putitemcommand', // DynamoDB writes
  'updateitemcommand',
  'deleteitemcommand',
]);
// Strong single-token methods: specific enough to fire without a multi-segment path
// (an email leaves, an object is written to a bucket, a message enters a queue — all
// observable and irreversible). Deliberately narrow to keep false positives near zero.
const EFFECT_SDK_METHODS = new Set([
  'sendmail', // nodemailer transporter.sendMail
  'sendemail', // AWS SES sendEmail
  'sendemailcommand',
  'putobject', // AWS S3 putObject
  'deleteobject',
  'copyobject',
  'sendmessage', // AWS SQS sendMessage
  'publishcommand',
]);

// The property path below the root of a call (`stripe.charges.create` → "charges.create"),
// lowercased, non-computed segments only. Null if not a plain member chain.
function memberPathBelowRoot(memberExpr) {
  const segs = [];
  let cur = memberExpr;
  while (cur.type === 'MemberExpression') {
    if (cur.computed || cur.property.type !== 'Identifier') return null;
    segs.unshift(cur.property.name.toLowerCase());
    if (cur.object.type === 'ThisExpression') break;
    cur = cur.object;
  }
  segs.pop(); // drop the method itself — we want the path BELOW root, incl. method re-added below
  return segs;
}

// Innate-immunity match: does this call's shape name a known irreversible external effect?
// Returns { httpMethod, target } to emit as an observable http_call, or null.
function knownExternalEffect(callee, methodLower, node) {
  if (callee.type !== 'MemberExpression') return null;
  // AWS SDK v3 shape: `client.send(new PutObjectCommand(...))` — the command class in the
  // argument names the effect, the `.send` verb alone does not.
  if (methodLower === 'send' && node) {
    const arg0 = node.arguments?.[0];
    const cmd =
      arg0?.type === 'NewExpression' && arg0.callee?.type === 'Identifier'
        ? arg0.callee.name.toLowerCase()
        : null;
    if (cmd && EFFECT_SDK_COMMANDS.has(cmd))
      return { httpMethod: 'POST', target: `sdk:${cmd}` };
  }
  const below = memberPathBelowRoot(callee); // e.g. ["charges"] for stripe.charges.create
  const path = below === null ? methodLower : [...below, methodLower].join('.');
  const hit =
    EFFECT_SDK_METHODS.has(methodLower) ||
    EFFECT_SDK_PATHS.has(path) ||
    [...EFFECT_SDK_PATHS].some((sig) => path.endsWith('.' + sig));
  if (!hit) return null;
  // Vendor writes are non-idempotent from the outside → POST makes the effect algebra mark
  // it observable + non-compensable, which is the whole point (O4 must see the irreversibility).
  return { httpMethod: 'POST', target: `sdk:${path}` };
}
// Import provenance for effect clients (the ant cuticular-hydrocarbon / "colony odor" model):
// a binding IMPORTED from a package whose whole job is an external side effect (payment, mail,
// SMS, cloud storage, queue, push) carries an effect LABEL acquired at its source — and that
// label propagates by contact: `const stripe = require('stripe')(key)`, `const s3 = new
// S3Client()`, `const x = s3`. Thereafter ANY call on a labeled binding is recognized as an
// external effect by ORIGIN, not by guessing the method name — which is what the bare `.send()`
// tail (SendGrid `sgMail.send`, Kafka `producer.send`) needs. Read-shaped methods stay GET (not
// observable), so a `.get`/`.list`/`.retrieve` never becomes a false irreversibility finding.
const EFFECT_PACKAGES = new Set([
  // payment
  'stripe',
  'braintree',
  'razorpay',
  'square',
  // mail
  '@sendgrid/mail',
  'nodemailer',
  'resend',
  'postmark',
  'mailgun.js',
  '@mailchimp/mailchimp_transactional',
  // sms / comms / push
  'twilio',
  '@slack/web-api',
  'firebase-admin',
  // cloud (v3 clients) + legacy aws-sdk v2
  'aws-sdk',
  '@aws-sdk/client-s3',
  '@aws-sdk/client-ses',
  '@aws-sdk/client-sesv2',
  '@aws-sdk/client-sns',
  '@aws-sdk/client-sqs',
  '@aws-sdk/client-lambda',
  '@aws-sdk/client-dynamodb',
  '@google-cloud/storage',
  '@google-cloud/pubsub',
  // queues / streams
  'kafkajs',
  'amqplib',
]);
// A read-shaped method on an effect client is a GET (idempotent, NOT observable) — so tagging a
// client can never turn a `.retrieve`/`.list` into a false irreversible effect. Everything else
// on a labeled client is treated as an outbound POST (observable). Config/wiring methods emit no
// effect at all.
const SDK_READ_METHOD =
  /^(get|list|describe|retrieve|fetch|read|find|query|scan|head|count|exists|search)/;
const SDK_IGNORE_METHOD = new Set([
  'setapikey',
  'config',
  'configure',
  'use',
  'on',
  'once',
  'off',
  'addeventlistener',
  'connect',
  'disconnect',
  'end',
  'destroy',
  'constructor',
  'middleware',
  'setclient',
]);

// Collect the effect-labeled bindings of a module, in source order so a later `new X()` sees the
// earlier `import X`. Pure over the top-level body; returns a Set of local names.
function collectEffectClients(body) {
  const labeled = new Set();
  const isLabeled = (n) => n?.type === 'Identifier' && labeled.has(n.name);
  for (const node of body) {
    if (node.type === 'ImportDeclaration') {
      if (EFFECT_PACKAGES.has(node.source.value))
        for (const s of node.specifiers) labeled.add(s.local.name);
      continue;
    }
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations) {
      const init = d.init;
      if (!init || d.id.type !== 'Identifier') continue;
      const requirePkg =
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'require' &&
        init.arguments[0]?.type === 'StringLiteral'
          ? init.arguments[0].value
          : null;
      if (
        // const x = require('stripe')  OR  const x = require('stripe')(key)  (factory)
        (requirePkg && EFFECT_PACKAGES.has(requirePkg)) ||
        (init.type === 'CallExpression' &&
          init.callee.type === 'CallExpression' &&
          init.callee.callee?.type === 'Identifier' &&
          init.callee.callee.name === 'require' &&
          EFFECT_PACKAGES.has(init.callee.arguments?.[0]?.value)) ||
        // const y = new X(...)  /  const y = X(...)  where X is already labeled
        (init.type === 'NewExpression' && isLabeled(init.callee)) ||
        (init.type === 'CallExpression' && isLabeled(init.callee)) ||
        // const y = x  (alias)
        isLabeled(init)
      )
        labeled.add(d.id.name);
    }
  }
  return labeled;
}

// Persistence-client packages: a binding imported from one, or built (`new`/call) from such an
// import, is a PROVEN database handle — by provenance, not by its name (ADR-068). Used to close
// the opaque-write hole: an UNKNOWN method on a proven handle (`db.nukeEverything(...)`) must be
// treated as a write, not ignored, or an unguarded custom write passes invisible.
const DB_PACKAGES = new Set([
  'knex',
  'pg',
  'pg-pool',
  'mysql',
  'mysql2',
  'mysql2/promise',
  'mongoose',
  'mongodb',
  'sequelize',
  'typeorm',
  'drizzle-orm',
  '@prisma/client',
  'better-sqlite3',
  '@libsql/client',
  'postgres',
  'sqlite3',
  '@mikro-orm/core',
  'objection',
  'kysely',
]);

// Methods on a DB handle that are clearly READS — never flagged as an opaque write.
const DB_KNOWN_READ = new Set([
  'select',
  'find',
  'findone',
  'findmany',
  'findunique',
  'findfirst',
  'findall',
  'first',
  'get',
  'getone',
  'getmany',
  'count',
  'exists',
  'all',
  'aggregate',
  'scan',
  'list',
  'fetch',
  'read',
  'describe',
  'explain',
  'has',
  'pluck',
  'stream',
  'cursor',
  'iterate',
  'tolist',
  'toarray',
]);
// Plumbing / chaining / promise / introspection / wiring on a DB handle — never an effect. Also
// parks the ambiguous raw-SQL methods (`raw`/`query`/`execute`) OUT of the opaque-write fallback:
// their literal-vs-dynamic read/write split is a separate follow-on (ADR-068), and firing them
// blindly would flood reads. So V1 catches the custom-named write (`db.archiveAll()`), not raw SQL.
const DB_NON_EFFECT = new Set([
  'then',
  'catch',
  'finally',
  'tostring',
  'valueof',
  'tosql',
  'toquery',
  'clone',
  'as',
  'ref',
  'unref',
  'on',
  'off',
  'once',
  'emit',
  'addlistener',
  'removelistener',
  'destroy',
  'end',
  'connect',
  'disconnect',
  'close',
  'release',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'transaction',
  'pipe',
  'listen',
  'use',
  'ping',
  'authenticate',
  'sync',
  'define',
  'model',
  'prepare',
  'unprepare',
  'bind',
  'escape',
  'format',
  'migrate',
  'seed',
  'schema',
  'fn',
  'client',
  'pool',
  'raw',
  'query',
  'execute',
  'exec',
  'command',
  'sql',
  'template',
  'with',
  'withschema',
  'table',
]);

// Auth packages whose guard middleware PROVABLY DENIES (401/403/throw) on missing/invalid auth.
// A catalog of VERIFIED published facts (versioned, auditable) — NOT a name guess (ADR-069): the
// claim is "`passport.authenticate()` denies", checkable by anyone reading passport once. This is
// what lets an opaque npm auth guard count as VERIFIED instead of merely asserted, so a real app
// on passport/express-jwt can legitimately reach PROVEN. Innate immunity: know the known pathogens.
const AUTH_GUARD_PACKAGES = new Set([
  'passport',
  'express-jwt',
  'express-oauth2-jwt-bearer',
  'express-openid-connect',
  'connect-ensure-login',
  'express-basic-auth',
  '@clerk/clerk-sdk-node',
]);

const objectOptionIsFalse = (objNode, key) =>
  objNode?.type === 'ObjectExpression' &&
  objNode.properties.some(
    (p) =>
      p.type === 'ObjectProperty' &&
      p.key?.type === 'Identifier' &&
      p.key.name === key &&
      p.value.type === 'BooleanLiteral' &&
      p.value.value === false,
  );

// Is this call a known auth-lib DENY-form middleware, per the provenance map `pkgOf`
// (localName → package)? Deny-FORM precision keeps the catalog honest — a form that does NOT
// auto-deny is abstained on (stays asserted, the safe direction), never falsely verified:
//   • passport.authenticate(strategy, opts?) denies UNLESS a custom callback fn is passed
//     (then the deny logic is the user's, not passport's default 401).
//   • express-jwt expressjwt(opts) throws UNLESS `credentialsRequired: false`.
export function authDenyCall(node, pkgOf) {
  if (node?.type !== 'CallExpression' || !pkgOf) return false;
  const callee = node.callee;
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'authenticate' &&
    pkgOf.get(callee.object.name) === 'passport'
  ) {
    const hasCallback = node.arguments.some(
      (a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
    );
    return !hasCallback;
  }
  if (callee.type === 'Identifier') {
    const pkg = pkgOf.get(callee.name);
    if (!pkg || !AUTH_GUARD_PACKAGES.has(pkg)) return false;
    if (pkg === 'express-jwt')
      return !objectOptionIsFalse(node.arguments[0], 'credentialsRequired');
    return true;
  }
  return false;
}

// Provenance for auth guards: the import map (localName → package) plus the local const names
// bound to a deny-form auth call (`const requireAuth = passport.authenticate('jwt')`). Same shape
// as collectDbHandles/collectEffectClients — provenance, never a name test.
export function collectAuthGuards(body) {
  const pkgOf = new Map();
  for (const node of body)
    if (node.type === 'ImportDeclaration')
      for (const s of node.specifiers) pkgOf.set(s.local.name, node.source.value);
  const denyBindings = new Set();
  for (const node of body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations)
      if (d.id.type === 'Identifier' && authDenyCall(d.init, pkgOf))
        denyBindings.add(d.id.name);
  }
  return { pkgOf, denyBindings };
}

// Vars/params bound to a database handle, by IMPORT PROVENANCE (same shape as
// collectEffectClients): imported from a DB package, or `new X()`/`X(...)`/alias of a labeled
// binding. Deliberately provenance-only — never a name test — so `const db = notARealDb` is NOT
// a handle, and a handle named `store` still IS one.
function collectDbHandles(body) {
  const labeled = new Set();
  const isLabeled = (n) => n?.type === 'Identifier' && labeled.has(n.name);
  for (const node of body) {
    if (node.type === 'ImportDeclaration') {
      if (DB_PACKAGES.has(node.source.value))
        for (const s of node.specifiers) labeled.add(s.local.name);
      continue;
    }
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations) {
      const init = d.init;
      if (!init) continue;
      // CommonJS destructured require — `const { PrismaClient } = require('@prisma/client')`.
      // The ESM twin is labelled above; without this the CJS half of the world had NO proven
      // handles at all, leaving every provenance-based net (including the opaque-write one)
      // inert there.
      if (
        d.id.type === 'ObjectPattern' &&
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'require' &&
        DB_PACKAGES.has(init.arguments[0]?.value)
      ) {
        for (const p of d.id.properties)
          if (p.type === 'ObjectProperty' && p.value?.type === 'Identifier')
            labeled.add(p.value.name);
        continue;
      }
      if (d.id.type !== 'Identifier') continue;
      const requirePkg =
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'require' &&
        init.arguments[0]?.type === 'StringLiteral'
          ? init.arguments[0].value
          : null;
      if (
        (requirePkg && DB_PACKAGES.has(requirePkg)) ||
        (init.type === 'CallExpression' &&
          init.callee.type === 'CallExpression' &&
          init.callee.callee?.type === 'Identifier' &&
          init.callee.callee.name === 'require' &&
          DB_PACKAGES.has(init.callee.arguments?.[0]?.value)) ||
        (init.type === 'NewExpression' && isLabeled(init.callee)) ||
        (init.type === 'CallExpression' && isLabeled(init.callee)) ||
        isLabeled(init)
      )
        labeled.add(d.id.name);
    }
  }
  return labeled;
}

// TypeORM repository provenance — like the effect-client label, but for ORM repositories, so a
// `repo.save()` / `this.userRepo.save()` resolves to a db_write with its entity table even though
// the table is nowhere in the call. Two sources: (1) a class constructor param that is an injected
// or typed repository (`@InjectRepository(User) repo` / `repo: Repository<User>`), keyed by field
// name; (2) a local `const r = getRepository(User)` (or `ds.getRepository(User)`), keyed by var.
// The entity name is lowercased to a table, matching how Prisma models are keyed.
export function collectRepoFields(cls) {
  const map = new Map();
  if (!cls?.body?.body) return map;
  const ctor = cls.body.body.find(
    (m) => m.type === 'ClassMethod' && m.kind === 'constructor',
  );
  for (const param of ctor?.params ?? []) {
    // NestJS constructor params are `TSParameterProperty` wrapping the real Identifier.
    const inner = param.type === 'TSParameterProperty' ? param.parameter : param;
    const field = inner?.type === 'Identifier' ? inner.name : null;
    if (!field) continue;
    // entity from `@InjectRepository(User)` (authoritative) …
    let entity = null;
    for (const dec of param.decorators ?? []) {
      const call = dec.expression;
      if (
        call?.type === 'CallExpression' &&
        call.callee.type === 'Identifier' &&
        call.callee.name === 'InjectRepository' &&
        call.arguments[0]?.type === 'Identifier'
      )
        entity = call.arguments[0].name;
    }
    // … or from the `Repository<User>` / `TreeRepository<User>` type annotation.
    if (!entity) {
      const ta = inner.typeAnnotation?.typeAnnotation;
      if (
        ta?.type === 'TSTypeReference' &&
        /repository$/i.test(ta.typeName?.name ?? '') &&
        ta.typeParameters?.params?.[0]?.type === 'TSTypeReference'
      )
        entity = ta.typeParameters.params[0].typeName?.name ?? null;
    }
    if (entity) map.set(field, entity.toLowerCase());
  }
  return map;
}

// Merge the class-level repo fields with the body-local repo vars into one lookup (or null when
// both are empty, so the common non-TypeORM path allocates nothing).
function mergeRepoTables(fields, vars) {
  if ((!fields || !fields.size) && (!vars || !vars.size)) return null;
  const m = new Map(fields ?? []);
  for (const [k, v] of vars ?? []) m.set(k, v);
  return m;
}

function collectRepoVars(fnNode) {
  const map = new Map();
  walkAst(fnNode, (node) => {
    if (
      node.type !== 'VariableDeclarator' ||
      node.id?.type !== 'Identifier' ||
      node.init?.type !== 'CallExpression'
    )
      return;
    const callee = node.init.callee;
    const isGetRepo =
      (callee.type === 'Identifier' && callee.name === 'getRepository') ||
      (callee.type === 'MemberExpression' &&
        callee.property?.type === 'Identifier' &&
        callee.property.name === 'getRepository');
    const entity = node.init.arguments?.[0];
    if (isGetRepo && entity?.type === 'Identifier')
      map.set(node.id.name, entity.name.toLowerCase());
  });
  return map;
}

// walkAst lives in resolve.js; a local minimal copy for the collectors above (extract.js must not
// import resolve.js — resolve.js imports extract.js).
function walkAst(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkAst(n, fn);
    return;
  }
  if (typeof node.type === 'string') fn(node);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
    const v = node[k];
    if (v && typeof v === 'object') walkAst(v, fn);
  }
}

const GUARD_NAME = /auth|guard|acl|permission|verif|session|admin|protect|role|token/i;

const moduleCache = new Map(); // absFile -> module facts (parse once per compile run)

export function clearModuleCache() {
  moduleCache.clear();
  tsconfigCache.clear();
  workspaceCache.clear();
  workspaceRootOf.clear();
}

// Upper bound on a single source file. Real hand-written modules top out well under
// 1 MB; past this line the file is generated output whose AST costs memory without
// yielding routes — analysis refuses cleanly instead of degrading the whole run.
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

// absFile → { ast, functions: Map<name,{node,line,exported}>, imports: Map<local,abs>, error }
export function parseModule(absFile) {
  if (moduleCache.has(absFile)) return moduleCache.get(absFile);
  const facts = {
    ast: null,
    functions: new Map(),
    imports: new Map(),
    reexports: new Map(), // barrel: `module.exports.x = require('./x')` → x -> file
    starReexports: [], // ESM barrel: `export * from './x'` → [file] (searched by name)
    error: null,
    _file: absFile, // the module's own path — DI resolution reports source locations
  };
  moduleCache.set(absFile, facts);

  let src;
  try {
    // memory guard: an auto-generated mega-file (bundles, fixtures dumped into src/)
    // would balloon the AST far past any useful analysis. Refuse to parse it and say
    // so — the error flows to the skip report, never a silent drop or an OOM crash.
    const { size } = fs.statSync(absFile);
    if (size > MAX_SOURCE_BYTES) {
      facts.error = `file exceeds the ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB analysis size cap (${Math.round(size / 1024 / 1024)} MB) — unmodelable`;
      return facts;
    }
    src = fs.readFileSync(absFile, 'utf8');
  } catch (err) {
    facts.error = `unreadable: ${err.message}`;
    return facts;
  }
  try {
    facts.ast = parse(src, {
      sourceType: 'unambiguous',
      // decorators-legacy = TypeScript's `experimentalDecorators`, which is what
      // NestJS/Medusa/TypeORM actually compile with. Unlike the modern `decorators`
      // plugin it allows PARAMETER decorators (`@Body()`, `@Param()`) — without this
      // every Nest controller is a parse error and the app reads as 0 routes.
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      attachComment: true,
    });
  } catch (err) {
    facts.error = `parse error: ${err.message.slice(0, 80)}`;
    return facts;
  }

  for (const node of facts.ast.program.body) collectTopLevel(node, facts, absFile, false);
  facts.effectClients = collectEffectClients(facts.ast.program.body);
  facts.dbHandles = collectDbHandles(facts.ast.program.body);
  facts.authGuards = collectAuthGuards(facts.ast.program.body);
  return facts;
}

// Resolve an exported function by name, FOLLOWING barrel re-exports — a route's
// `import { withWorkspace } from '@/lib/auth'` lands on `index.ts`, but the function
// lives in `./workspace` via `export * from './workspace'`. Returns `{ fn, mod }` (the
// defining module, so a later deep-scan follows ITS imports) or null. Bounded by `seen`.
export function resolveExportedFunction(mod, name, seen = new Set()) {
  if (!mod || mod.error) return null;
  const direct = mod.functions.get(name);
  if (direct) return { fn: direct, mod };
  const named = mod.reexports.get(name); // export { name } from './x'
  if (named && !seen.has(named)) {
    seen.add(named);
    const hit = resolveExportedFunction(parseModule(named), name, seen);
    if (hit) return hit;
  }
  for (const file of mod.starReexports ?? []) {
    // export * from './x'
    if (seen.has(file)) continue;
    seen.add(file);
    const hit = resolveExportedFunction(parseModule(file), name, seen);
    if (hit) return hit;
  }
  return null;
}

function collectTopLevel(node, facts, absFile, exported) {
  if (node.type === 'ExportNamedDeclaration' && node.declaration) {
    collectTopLevel(node.declaration, facts, absFile, true);
    return;
  }
  // ESM barrel re-exports — `export { withWorkspace } from './workspace'` (named) and
  // `export * from './workspace'` (wildcard). The near-universal `lib/auth/index.ts`
  // pattern: a route imports from the barrel, but the function lives in a sub-module.
  // Named re-exports resolve by name; wildcards are searched by name on demand.
  if (node.type === 'ExportNamedDeclaration' && node.source && node.specifiers) {
    const resolved = resolveRelImport(absFile, node.source.value);
    if (resolved)
      for (const spec of node.specifiers)
        if (spec.type === 'ExportSpecifier' && spec.exported.type === 'Identifier')
          facts.reexports.set(spec.exported.name, resolved);
    return;
  }
  if (node.type === 'ExportAllDeclaration' && node.source) {
    const resolved = resolveRelImport(absFile, node.source.value);
    if (resolved) facts.starReexports.push(resolved);
    return;
  }
  if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
    const d = node.declaration;
    if (d.type === 'FunctionDeclaration' || d.type === 'ArrowFunctionExpression') {
      facts.functions.set(d.id?.name ?? 'default', {
        node: d,
        line: d.loc?.start.line ?? 0,
        exported: true,
      });
    }
    return;
  }
  if (node.type === 'FunctionDeclaration' && node.id) {
    facts.functions.set(node.id.name, {
      node,
      line: node.loc?.start.line ?? 0,
      exported,
    });
    return;
  }
  if (node.type === 'VariableDeclaration') {
    for (const d of node.declarations) {
      const init = d.init;
      if (d.id?.type !== 'Identifier' || !init) continue;
      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
        facts.functions.set(d.id.name, {
          node: init,
          line: d.loc?.start.line ?? 0,
          exported,
        });
      } else if (
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'require' &&
        init.arguments[0]?.type === 'StringLiteral'
      ) {
        const resolved = resolveRelImport(absFile, init.arguments[0].value);
        if (resolved) {
          if (d.id.type === 'Identifier') facts.imports.set(d.id.name, resolved);
        }
      } else if (init.type === 'CallExpression') {
        // wrapper idiom: const register = catchAsync(async (req, res) => …)
        // — the wrapped function IS the behavior; the wrapper is plumbing
        const fnArg = init.arguments.find(
          (a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
        );
        if (fnArg) {
          facts.functions.set(d.id.name, {
            node: fnArg,
            line: d.loc?.start.line ?? 0,
            exported,
          });
        }
      }
    }
    // destructured require: const { a, b } = require('./x')
    for (const d of node.declarations) {
      if (
        d.id?.type === 'ObjectPattern' &&
        d.init?.type === 'CallExpression' &&
        d.init.callee.type === 'Identifier' &&
        d.init.callee.name === 'require' &&
        d.init.arguments[0]?.type === 'StringLiteral'
      ) {
        const resolved = resolveRelImport(absFile, d.init.arguments[0].value);
        if (!resolved) continue;
        // if the required module is a barrel, resolve each destructured member to the
        // sub-module it re-exports (`{ userService }` → user.service.js, not index.js).
        const barrel = resolved === absFile ? null : parseModule(resolved);
        for (const prop of d.id.properties) {
          if (
            prop.type === 'ObjectProperty' &&
            prop.value.type === 'Identifier' &&
            prop.key.type === 'Identifier'
          ) {
            const viaBarrel = barrel?.reexports.get(prop.key.name);
            facts.imports.set(prop.value.name, viaBarrel ?? resolved);
          }
        }
      }
    }
    return;
  }
  if (node.type === 'ImportDeclaration') {
    const resolved = resolveRelImport(absFile, node.source.value);
    if (!resolved) return;
    for (const spec of node.specifiers) facts.imports.set(spec.local.name, resolved);
    return;
  }
  // barrel re-export: `module.exports.userService = require('./user.service')` or
  // `exports.userService = require('./user.service')`. Records member → file so a
  // `const { userService } = require('./services')` resolves to the real module.
  if (
    node.type === 'ExpressionStatement' &&
    node.expression.type === 'AssignmentExpression' &&
    node.expression.left.type === 'MemberExpression' &&
    node.expression.left.property.type === 'Identifier'
  ) {
    const left = node.expression.left;
    const isExports =
      (left.object.type === 'Identifier' && left.object.name === 'exports') ||
      (left.object.type === 'MemberExpression' &&
        left.object.object.type === 'Identifier' &&
        left.object.object.name === 'module' &&
        left.object.property.type === 'Identifier' &&
        left.object.property.name === 'exports');
    const rhs = node.expression.right;
    if (
      isExports &&
      rhs.type === 'CallExpression' &&
      rhs.callee.type === 'Identifier' &&
      rhs.callee.name === 'require' &&
      rhs.arguments[0]?.type === 'StringLiteral'
    ) {
      const resolved = resolveRelImport(absFile, rhs.arguments[0].value);
      if (resolved) facts.reexports.set(left.property.name, resolved);
    }
    // Direct function export: `module.exports.createOrder = async (b) => …` / `exports.f =
    // function () {}` / a wrapped `exports.create = catchAsync(async () => …)`. A common
    // CommonJS style the const-arrow path never saw, so the exported function was invisible
    // and every effect below it (often a sibling workspace package away) dead-ended. Register
    // it under the exported name so a `service.createOrder()` call resolves to this body.
    else if (isExports) {
      const bodyFn =
        rhs.type === 'ArrowFunctionExpression' || rhs.type === 'FunctionExpression'
          ? rhs
          : rhs.type === 'CallExpression'
            ? rhs.arguments.find(
                (a) =>
                  a?.type === 'ArrowFunctionExpression' ||
                  a?.type === 'FunctionExpression',
              )
            : null;
      if (bodyFn)
        facts.functions.set(left.property.name, {
          node: bodyFn,
          line: node.loc?.start.line ?? 0,
          exported: true,
        });
    }
  }
}

export function resolveRelImport(fromFile, spec) {
  const clean = (s) => s.replace(/\.(m?[jt]s|cjs)$/, '');
  if (spec.startsWith('.')) {
    return firstModuleFile(path.resolve(path.dirname(fromFile), clean(spec)));
  }
  // Non-relative: a TS baseUrl/paths alias (`src/services/x`, `@app/x`) — the shape
  // real monorepos (immich, Nest apps) use instead of `../../`. Without this the
  // cross-module hop (controller → service → repository) dead-ends and effects behind
  // DI are invisible. A bare npm package (`kysely`, `@nestjs/common`) simply resolves
  // to nothing here (no matching file under the project), which is correct.
  //
  // The WORKSPACE fallback (the mycorrhizal network): a monorepo app's real mutation
  // logic lives in shared workspace packages it imports by NAME, not by path — cal.com's
  // `this.svc.updateEventType()` delegates to `@calcom/platform-libraries` → `@calcom/trpc`
  // → `prisma.update()`, three packages away and entirely outside the analyzed app dir. A
  // tsconfig alias can't reach them (they're resolved via the workspace, not `paths`). So
  // when the alias miss, map the `@scope/pkg[/subpath]` specifier to the package's real
  // directory under the workspace and resolve into it. Trees share nutrients across the
  // fungal network, not just their own root ball — the schema/effect code is a shared
  // nutrient drawn from the workspace, not the app's own folder.
  return (
    resolveAliasedImport(fromFile, clean(spec)) ??
    resolveWorkspaceImport(fromFile, clean(spec))
  );
}

// name -> absolute package dir, for every package in the workspace that owns `fromFile`.
// Cached per workspace root (built once, ~100 package.json reads on a giant monorepo).
const workspaceCache = new Map(); // rootDir -> Map(name -> dir)
const workspaceRootOf = new Map(); // dir -> rootDir | null

// walk up to the monorepo root: the nearest ancestor whose package.json declares
// `workspaces`, or that carries a pnpm-workspace.yaml. `null` = not a workspace.
function findWorkspaceRoot(fromFile) {
  let dir = path.dirname(fromFile);
  const chain = [];
  for (let i = 0; i < 40; i++) {
    if (workspaceRootOf.has(dir)) {
      const v = workspaceRootOf.get(dir);
      for (const d of chain) workspaceRootOf.set(d, v);
      return v;
    }
    chain.push(dir);
    let root = null;
    try {
      const pj = path.join(dir, 'package.json');
      if (fs.existsSync(pj)) {
        const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
        if (pkg.workspaces) root = dir;
      }
      if (!root && fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) root = dir;
    } catch {
      // unreadable manifest — keep walking up
    }
    if (root) {
      for (const d of chain) workspaceRootOf.set(d, root);
      return root;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of chain) workspaceRootOf.set(d, null);
  return null;
}

// the workspace's package globs, from package.json `workspaces` (array or {packages})
// or a minimal pnpm-workspace.yaml parse (the `- '...'` list under `packages:`).
function workspaceGlobs(root) {
  const globs = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const ws = pkg.workspaces;
    if (Array.isArray(ws)) globs.push(...ws);
    else if (ws && Array.isArray(ws.packages)) globs.push(...ws.packages);
  } catch {
    // no/invalid root package.json — fall through to pnpm
  }
  try {
    const yml = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    for (const m of yml.matchAll(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)) globs.push(m[1]);
  } catch {
    // no pnpm-workspace.yaml
  }
  return globs;
}

// expand one workspace glob to concrete package dirs. Supports the two forms real
// workspaces use: an exact path (`packages/app-store`) and a trailing `/*` (one level of
// subdirs, e.g. `packages/*`, `packages/platform/*`). `**` is treated as a single level —
// good enough for every workspace layout in the wild, and never unbounded.
function expandGlob(root, glob) {
  const g = glob.replace(/\/\*\*$/, '/*');
  const star = g.indexOf('*');
  if (star === -1) return [path.resolve(root, g)];
  const baseRel = g.slice(0, star).replace(/\/$/, '');
  const baseDir = path.resolve(root, baseRel);
  try {
    return fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(baseDir, e.name));
  } catch {
    return [];
  }
}

export function workspacePackages(fromFile) {
  const root = findWorkspaceRoot(fromFile);
  if (!root) return null;
  if (workspaceCache.has(root)) return workspaceCache.get(root);
  const map = new Map();
  for (const glob of workspaceGlobs(root)) {
    for (const dir of expandGlob(root, glob)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (typeof pkg.name === 'string' && !map.has(pkg.name)) map.set(pkg.name, dir);
      } catch {
        // not a package (no/invalid package.json) — skip
      }
    }
  }
  workspaceCache.set(root, map);
  return map;
}

// the entry file of a package with no subpath import (`@calcom/trpc`): its declared
// source/main/module, else the conventional src/index or index.
function packageEntry(dir) {
  const fields = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const f of [pkg.source, pkg.module, pkg.main])
      if (typeof f === 'string') fields.push(f);
  } catch {
    // no package.json fields — conventions below still apply
  }
  for (const f of [...fields, 'src/index', 'index']) {
    const hit = firstModuleFile(path.resolve(dir, f.replace(/\.(m?[jt]s|cjs)$/, '')));
    if (hit) return hit;
  }
  return null;
}

// resolve `@scope/pkg/subpath` (or `pkg/subpath`) to a real source file under the
// workspace. Longest package-name match wins (`@calcom/platform-libraries` beats a
// hypothetical `@calcom/platform`), then the subpath resolves against the package dir.
function resolveWorkspaceImport(fromFile, spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return null;
  const map = workspacePackages(fromFile);
  if (!map) return null;
  let best = null;
  for (const name of map.keys()) {
    if (
      (spec === name || spec.startsWith(name + '/')) &&
      name.length > (best?.length ?? -1)
    )
      best = name;
  }
  if (!best) return null;
  const dir = map.get(best);
  const sub = spec.length > best.length ? spec.slice(best.length + 1) : '';
  return sub ? firstModuleFile(path.resolve(dir, sub)) : packageEntry(dir);
}

// probe the standard TS/JS extensions + index files for a resolved base path.
function firstModuleFile(base) {
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ]) {
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    } catch {
      // race between existsSync and statSync — treat as unresolvable
    }
  }
  return null;
}

// tsconfig baseUrl + paths, resolved from the nearest ancestor project. Cached per
// directory so the walk-up + read happens once. `null` = no project found.
const tsconfigCache = new Map();
function projectConfig(fromFile) {
  const chain = [];
  let dir = path.dirname(fromFile);
  for (let i = 0; i < 40; i++) {
    if (tsconfigCache.has(dir)) {
      const v = tsconfigCache.get(dir);
      for (const d of chain) tsconfigCache.set(d, v);
      return v;
    }
    chain.push(dir);
    const tsc = path.join(dir, 'tsconfig.json');
    let v;
    if (fs.existsSync(tsc)) v = readTsconfig(tsc, dir);
    else if (fs.existsSync(path.join(dir, 'package.json')))
      v = { baseDir: dir, paths: {} };
    if (v) {
      for (const d of chain) tsconfigCache.set(d, v);
      return v;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of chain) tsconfigCache.set(d, null);
  return null;
}

function readTsconfig(file, dir) {
  try {
    const co =
      JSON.parse(stripJsonc(fs.readFileSync(file, 'utf8'))).compilerOptions ?? {};
    return {
      baseDir: co.baseUrl ? path.resolve(dir, co.baseUrl) : dir,
      paths: co.paths ?? {},
    };
  } catch {
    return { baseDir: dir, paths: {} };
  }
}

// Strip JSONC comments + trailing commas the ONLY safe way: a string-aware scan.
// A regex cannot do this — a tsconfig path glob like `["pages/*"]` contains `/*`, and a
// later `["**/*.ts"]` contains `*/`, so a naive block-comment regex deletes the whole
// span between them (silently wiping `paths`, killing every alias hop). We track string
// state and only treat `//` and `/* */` as comments outside strings.
function stripJsonc(src) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += src[++i] ?? ''; // escaped char passes through verbatim
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i++; // land on '/', loop's i++ steps past it
    } else {
      out += c;
    }
  }
  // trailing commas: `,}` / `,]` (whitespace between) — invalid JSON, valid JSONC
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function resolveAliasedImport(fromFile, spec) {
  const cfg = projectConfig(fromFile);
  if (!cfg) return null;
  const candidates = [];
  // explicit tsconfig `paths` (e.g. "@app/*": ["src/app/*"])
  for (const [pattern, targets] of Object.entries(cfg.paths)) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      if (pattern === spec) for (const t of targets) candidates.push(t);
      continue;
    }
    const pre = pattern.slice(0, star);
    const post = pattern.slice(star + 1);
    if (
      spec.startsWith(pre) &&
      spec.endsWith(post) &&
      spec.length >= pre.length + post.length
    ) {
      const mid = spec.slice(pre.length, spec.length - post.length);
      for (const t of targets) candidates.push(t.replace('*', mid));
    }
  }
  // implicit baseUrl resolution + the near-universal `src/` root fallback, so the
  // common `baseUrl:"."` + `"src/*":["src/*"]` config works even if paths is absent.
  const bases = candidates
    .map((c) => path.resolve(cfg.baseDir, c))
    .concat([path.resolve(cfg.baseDir, spec), path.resolve(cfg.baseDir, 'src', spec)]);
  for (const b of bases) {
    const hit = firstModuleFile(b);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Class resolution — shared by the Nest DI follower (this.<dep>.<m>()) and the
// Express instantiated-service follower (new Service().<m>()). A method lookup
// climbs the `extends` chain because real services inherit their behavior
// (directus: ActivityService extends ItemsService, where the DB calls live).
// ---------------------------------------------------------------------------

const MAX_CLASS_DEPTH = 6;

// find a class declaration named `typeName` at a module's top level (plain,
// export-named, or export-default with a matching name).
export function classInModule(mod, typeName) {
  for (const node of mod.ast?.program.body ?? []) {
    const cls =
      node.type === 'ClassDeclaration'
        ? node
        : (node.type === 'ExportNamedDeclaration' ||
              node.type === 'ExportDefaultDeclaration') &&
            node.declaration?.type === 'ClassDeclaration'
          ? node.declaration
          : null;
    if (cls && cls.id?.name === typeName) return cls;
  }
  return null;
}

// resolve `class X extends Base` → the Base class node + its module, via the import.
export function baseClassOf(cls, mod) {
  if (cls.superClass?.type !== 'Identifier') return null;
  const file = mod.imports.get(cls.superClass.name);
  if (!file || !fs.existsSync(file)) return null;
  const baseMod = parseModule(file);
  if (baseMod.error) return null;
  const baseCls = classInModule(baseMod, cls.superClass.name);
  return baseCls ? { cls: baseCls, mod: baseMod } : null;
}

// locate `methodName` on the class or up its `extends` chain →
// { fn, mod, cls } where `cls`/`mod` are the DECLARING class and its module
// (base-class methods live in the base module — the caller needs both for
// source locations and for resolving `super.<m>()` from the right link).
export function methodInClassChain(cls, mod, methodName, depth = 0) {
  for (const m of cls.body.body) {
    if (
      m.type === 'ClassMethod' &&
      m.key.type === 'Identifier' &&
      m.key.name === methodName
    )
      return { fn: m, mod, cls };
  }
  if (depth >= MAX_CLASS_DEPTH) return null;
  const base = baseClassOf(cls, mod);
  return base ? methodInClassChain(base.cls, base.mod, methodName, depth + 1) : null;
}

// Cross-class symbolic dataflow: at a `new X(arg0, …)` site, bind X's `this.<field>`
// to the symbolic value of the constructor argument that feeds it — so a service
// instantiated as `new ItemsService(req.params.collection, …)` carries
// `{ collection: ':collection' }` into every method, letting `this.knex(this.collection)`
// resolve. Handles `this.field = param`, TS parameter properties, and `super(...)`
// (a literal super-arg like `super('directus_activity')` correctly yields a fixed
// table, NOT a symbol). Returns Map<field, ':name'>; empty when nothing is request-derived.
export function computeThisSymbols(
  cls,
  clsMod,
  argNodes,
  callerFnNode,
  callerThisSymbols,
) {
  // the caller's request-derived vars (`const c = req.params.collection`) so an arg
  // like `new X(c)` resolves — computed from the caller body, not passed in as a map.
  const callerReqDerived = callerFnNode ? collectReqDerived(callerFnNode) : null;
  const argValues = argNodes.map((a) => argValue(a, callerReqDerived, callerThisSymbols));
  // Never bail on "no symbolic arg": a constructor can bind `this.<field>` from an
  // INTERNAL literal too (`super('directus_activity')`, `this.collection = 'users'`),
  // which is a concrete table independent of what the caller passed.
  return bindConstructor(cls, clsMod, argValues, 0);
}

// A constructor argument's table value: a string LITERAL is a concrete table
// (`super('directus_activity')`); anything request- or this-derived is a symbolic
// `:name`. The `:` prefix is what marks a value symbolic downstream.
function argValue(node, reqDerived, thisSymbols) {
  if (node?.type === 'StringLiteral') return node.value.toLowerCase();
  return reqParamName(node, reqDerived, thisSymbols);
}

function bindConstructor(cls, clsMod, argValues, depth) {
  const out = new Map();
  if (!cls || depth > MAX_CLASS_DEPTH) return out;
  const ctor = cls.body.body.find(
    (m) => m.type === 'ClassMethod' && m.kind === 'constructor',
  );
  if (!ctor) {
    // implicit constructor → arguments pass straight to the base (implicit super)
    const base = baseClassOf(cls, clsMod);
    return base ? bindConstructor(base.cls, base.mod, argValues, depth + 1) : out;
  }
  // constructor param name → the table value of the argument in that position
  const paramVal = new Map();
  ctor.params.forEach((p, i) => {
    const id = p.type === 'TSParameterProperty' ? p.parameter : p;
    if (id?.type !== 'Identifier' || argValues[i] == null) return;
    paramVal.set(id.name, argValues[i]);
    // TS parameter property `constructor(public collection: C)` auto-assigns this.collection
    if (p.type === 'TSParameterProperty') out.set(id.name, argValues[i]);
  });
  walkNodes(ctor.body, (n) => {
    // this.<field> = <param>  OR  this.<field> = '<literal table>'
    if (
      n.type === 'AssignmentExpression' &&
      n.left.type === 'MemberExpression' &&
      n.left.object.type === 'ThisExpression' &&
      n.left.property.type === 'Identifier'
    ) {
      if (n.right.type === 'Identifier' && paramVal.has(n.right.name))
        out.set(n.left.property.name, paramVal.get(n.right.name));
      else if (n.right.type === 'StringLiteral')
        out.set(n.left.property.name, n.right.value.toLowerCase());
    }
    // super(a, b, …) → map the base constructor with the values of these args (a
    // string literal there — `super('directus_activity')` — is a concrete table)
    if (
      n.type === 'CallExpression' &&
      n.callee.type === 'Super' &&
      cls.superClass?.type === 'Identifier'
    ) {
      const superVals = n.arguments.map((a) =>
        a.type === 'StringLiteral'
          ? a.value.toLowerCase()
          : a.type === 'Identifier'
            ? (paramVal.get(a.name) ?? null)
            : null,
      );
      const base = baseClassOf(cls, clsMod);
      if (base)
        for (const [k, v] of bindConstructor(base.cls, base.mod, superVals, depth + 1))
          if (!out.has(k)) out.set(k, v); // subclass binding wins
    }
  });
  return out;
}

// minimal recursive AST walker (constructor bodies are small; bounded by construction)
function walkNodes(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkNodes(n, fn);
    return;
  }
  if (typeof node.type === 'string') fn(node);
  for (const k of Object.keys(node)) {
    if (
      k === 'loc' ||
      k === 'range' ||
      k === 'leadingComments' ||
      k === 'trailingComments'
    )
      continue;
    const v = node[k];
    if (v && typeof v === 'object') walkNodes(v, fn);
  }
}

// ---------------------------------------------------------------------------
// scanFunction — what does this function DO?
// Plain recursive walk (no scope analysis: deterministic, dependency-free),
// bounded, source order preserved. Nested function declarations are NOT
// descended into as effects of the outer function only when they are
// immediately invoked — a defined-but-uncalled closure is that closure's
// business (kept simple: we DO descend; static over-approximation beats
// silent blindness, and passes can refine later).
// ---------------------------------------------------------------------------

export function scanFunction(fnNode, env = {}) {
  const result = {
    effects: [],
    returnShapes: [],
    calls: [],
    guardSignals: { deniesWithStatus: false },
    validatesInput: false,
    // O7/BOLA only (G1): the body asserts caller-ownership at a call site
    // (`getXOrThrow({ workspaceId: workspace.id })`) — an advisory-only signal.
    ownerAsserted: false,
    // G2 (guard-taxonomy families B–F): credential-check signals, SEPARATE from
    // guardSignals on purpose — they may only DOWNGRADE an UNGUARDED_MUTATION critical to
    // an advisory (never prove a guard, never silence a finding), so widening them can
    // never fabricate a gate (E-042) or a false PROVEN.
    credentialSignals: { verifyCall: false, denies4xxOrThrows: false, redirects: false },
    // guard-dominance (C2): set true once any in-body guard barrier is seen while walking the body.
    hasInBodyGuard: false,
    async: Boolean(fnNode?.async),
  };
  if (!fnNode) return result;
  visit(fnNode.body, result, {
    tx: null,
    isolation: 'default',
    tryId: null,
    catchOf: null,
    reqDerived: collectReqDerived(fnNode, env.reqDerivedSeed),
    // symbolic `this.<field>` bindings, supplied by the caller when this body is a
    // CLASS METHOD reached through `new X(req.params.collection)` — lets a
    // `this.knex(this.collection)` inside a service resolve to `:collection`.
    thisSymbols: env.thisSymbols ?? null,
    // effect-labeled bindings of the owning module (import-provenance), so a call on an
    // SDK client is recognized by origin. Absent → the path/command catalog still applies.
    effectClients: env.effectClients ?? null,
    dbHandles: env.dbHandles ?? null,
    // TypeORM repository provenance: class-injected repo fields (env.repoFields, from the owning
    // class) merged with local `getRepository(Entity)` vars found in THIS body → receiver → table.
    repoTables: mergeRepoTables(env.repoFields, collectRepoVars(fnNode)),
  });
  // guard-dominance: a mutation on an unguarded path is a real bypass ONLY when THIS body also holds
  // a guard (so a guard is genuinely being circumvented). A body with no guard of its own is guarded
  // elsewhere (positional middleware / a caller) — leave it to the route model, untouched. Strip the
  // temporary marker either way so it never leaks into the graph.
  for (const e of result.effects) {
    if (result.hasInBodyGuard && e._unguardedPath) e.bypassesGuard = true;
    delete e._unguardedPath;
  }
  return result;
}

// The request objects a handler names its input through. A table/target sourced from
// one of these is not a literal, but it is not unknown either: it is precisely "the
// value the caller supplies here" — a SYMBOLIC target, expressed as a rule.
const REQ_ROOTS = new Set(['req', 'request', 'ctx', 'context', 'event', 'request_']);

// strip TS wrappers that sit between a value and its expression: `x!`, `x as T`,
// `x satisfies T` — real code writes `req.params['collection']!`, and the `!` node
// would otherwise hide the member access underneath.
function unwrapTS(node) {
  while (
    node &&
    (node.type === 'TSNonNullExpression' ||
      node.type === 'TSAsExpression' ||
      node.type === 'TSSatisfiesExpression')
  )
    node = node.expression;
  return node;
}

// `req.params.collection` / `req.params['collection']` / `req.query.table` /
// `req.body.type` / `req.collection` → the leaf name, prefixed ':' to mark it symbolic.
// Also `this.<field>` when the caller supplied a symbolic binding for that field (a
// service instantiated with a request-derived arg). Null if neither req- nor this-derived.
// Is this value node PROVABLY request-derived — a taint source flowing into a write?
// Reuses the request-derivation the table resolver already trusts (`reqParamName`): a req
// member (`req.body`), a local aliased from one (`const b = req.body`), or an object
// literal that spreads/embeds either (`{ ...req.body }`, `{ name: body.name }`). It
// UNDER-approximates on purpose — a missed tag is a false negative on an ADVISORY tag
// (SOUNDNESS.md), never a hidden mutation: the write still flags on its own merits. The
// tag only ever DECORATES an already-emitted finding, so it can never add a false alarm.
function valueTainted(node, ctx) {
  node = unwrapTS(node);
  if (!node) return false;
  if (node.type === 'ObjectExpression')
    return node.properties.some((p) =>
      p.type === 'SpreadElement'
        ? valueTainted(p.argument, ctx)
        : p.type === 'ObjectProperty'
          ? valueTainted(p.value, ctx)
          : false,
    );
  if (node.type === 'ArrayExpression')
    return node.elements.some((e) => valueTainted(e, ctx));
  return reqParamName(node, ctx.reqDerived, ctx.thisSymbols) != null;
}

// keys that scope a query row to its owner — the ownership predicate that makes an
// id-scoped access safe (`where: { id, userId }`). Presence ⇒ NOT a BOLA.
const OWNERSHIP_KEY =
  /^(user|owner|account|workspace|team|tenant|organization|org|member|author|creator|project|customer|store|shop|company|group)s?_?id$/i;
// values that reference the CALLER's identity — the other shape of an ownership scope.
const OWNERSHIP_ROOT = /^(session|auth|me|currentuser|actor|viewer|loggedin)/i;

// Does this `where` object scope the row to the caller — an ownership key (`userId`), or a
// value read off the session/auth (`where: { id, teamId: session.teamId }`)? MUST-analysis
// (SOUNDNESS): we set it only when a scope is PROVEN, so "not scoped" is the honest default.
function whereOwnerScoped(whereNode) {
  if (whereNode?.type !== 'ObjectExpression') return false;
  let scoped = false;
  walkNodes(whereNode, (n) => {
    if (
      n.type === 'ObjectProperty' &&
      n.key?.type === 'Identifier' &&
      OWNERSHIP_KEY.test(n.key.name)
    )
      scoped = true;
    if (n.type === 'Identifier' && OWNERSHIP_ROOT.test(n.name)) scoped = true;
    if (n.type === 'MemberExpression') {
      const r = rootIdentifier(n);
      if (r && OWNERSHIP_ROOT.test(r)) scoped = true;
      // req.user.* / ctx.user.* — the caller's identity off the request object
      if (r && /^(req|request|ctx|context)$/i.test(r) && /user|auth/i.test(src2(n)))
        scoped = true;
    }
  });
  return scoped;
}

// Values that reference the caller's VERIFIED identity — the principal a guard puts on the
// path: dub's `withWorkspace` → `workspace`, a session → `session.user`, `req.user`. Broader
// than OWNERSHIP_ROOT because it must catch the framework's identity object by its conventional
// name (the thing a scoped mutation is measured against).
const IDENTITY_ROOT =
  /^(workspace|session|auth|user|me|currentuser|actor|viewer|principal|org|organization|team|project|tenant|account|membership)s?$/i;
// an identity token anywhere in an access path (`req.session.user`, `workspace.id`)
const IDENTITY_TOKEN =
  /^(workspace|session|auth|user|me|currentuser|actor|viewer|principal|org|organization|team|project|tenant|account|member|membership)s?$/i;
// request INPUT the caller controls — never the verified identity, even if named `workspaceId`
// (`req.body.workspaceId` is an attacker value; matching it would silence a REAL BOLA).
const REQ_INPUT = /^(body|query|params|input|payload|args|data)$/i;
function valueIsIdentity(node) {
  if (!node) return false;
  if (node.type === 'Identifier') return IDENTITY_ROOT.test(node.name);
  if (node.type !== 'MemberExpression') return false;
  // collect every identifier segment of the access path
  const parts = [];
  let cur = node;
  while (cur?.type === 'MemberExpression') {
    if (cur.property?.type === 'Identifier') parts.push(cur.property.name);
    cur = cur.object;
  }
  if (cur?.type === 'Identifier') parts.push(cur.name);
  if (parts.some((p) => REQ_INPUT.test(p))) return false; // caller-controlled → not identity
  return parts.some((p) => IDENTITY_TOKEN.test(p));
}

// Does this call assert caller-ownership at the site — an argument object binding an ownership
// KEY to a VERIFIED-IDENTITY value, `getCustomerOrThrow({ workspaceId: workspace.id, id })`?
// This is the caller stating, before it mutates, that the object it is about to touch is scoped
// to its own identity — visible WITHOUT resolving the (imported) helper. It feeds ONLY the O7
// BOLA advisory, never a hard rule, so it can never create a false PROVEN: at worst it silences
// an advisory the field test wants silenced (dub's ~60 false BOLA are exactly this pattern).
// the identity object passed to the helper BY NAME — `getDomainOrThrow({ workspace, domain })`
// hands the whole verified principal, not a `workspaceId:` key.
const IDENTITY_KEY =
  /^(workspace|session|user|team|project|tenant|account|org|organization|member|membership|owner|actor|principal)$/i;
function callAssertsOwnership(node) {
  for (const arg of node.arguments ?? []) {
    if (arg?.type !== 'ObjectExpression') continue;
    for (const p of arg.properties) {
      if (p.type !== 'ObjectProperty' || p.key?.type !== 'Identifier') continue;
      // (1) the verified identity handed in by name: `{ workspace, … }` / `{ session }`
      if (IDENTITY_KEY.test(p.key.name)) return true;
      // (2) an ownership key bound to the identity OR to a scope-named local (shorthand):
      // `{ workspaceId: workspace.id }` / `{ workspaceId }`. Same generosity whereOwnerScoped
      // already grants a `where` key — and O7 is advisory, so it can only silence an advisory.
      if (
        OWNERSHIP_KEY.test(p.key.name) &&
        (valueIsIdentity(p.value) || p.value?.type === 'Identifier')
      )
        return true;
    }
  }
  return false;
}

// Does this `if` assert caller-ownership by FETCH-THEN-COMPARE — the most common hand-rolled
// authorization check: `if (row.ownerId !== req.user.id) return res.sendStatus(403)`. The scope
// lives in a value comparison + deny, NOT in a `where` clause, so `whereOwnerScoped` abstains and
// O7 false-positives. This is the deterministic half of the generate-and-check loop (ADR-074): a
// proposed ownership witness ("scope is proven by comparing <field> to the principal, gating a
// deny") is VERIFIED here against the AST. SOUND both ways, adversarially tested:
//   • the compared-against value must be the caller's VERIFIED identity (`valueIsIdentity` rejects
//     `req.body.ownerId` — an attacker-controlled spoof — even though it is named like an owner);
//   • the branch must actually DENY (a throw or a 401/403 response) — a compare that only logs
//     proves nothing and is rejected.
// Advisory-only (feeds O7, never a hard rule), so it can never create a false PROVEN; at worst a
// mis-clear drops an advisory that was already non-gating.
function branchDenies(branch) {
  let denies = false;
  walkNodes(branch, (c) => {
    if (c.type === 'ThrowStatement') denies = true;
    if (c.type === 'CallExpression' && deniedStatusOf(c)) denies = true;
  });
  return denies;
}
export function ifAssertsOwnership(node) {
  if (node.type !== 'IfStatement') return false;
  if (!branchDenies(node.consequent)) return false;
  let owns = false;
  walkNodes(node.test, (b) => {
    if (b.type !== 'BinaryExpression' || !/^[=!]==?$/.test(b.operator)) return;
    // one side is the caller's verified identity, the OTHER is a fetched field (a member access
    // like `row.ownerId`). Order-agnostic. `valueIsIdentity` is the honesty gate — request input
    // (`req.body.*`, `req.params.*`) is never identity, so a spoofable compare is rejected.
    if (valueIsIdentity(b.left) && b.right?.type === 'MemberExpression') owns = true;
    if (valueIsIdentity(b.right) && b.left?.type === 'MemberExpression') owns = true;
  });
  return owns;
}

// ADR-074 V2 — the INTERPROCEDURAL ownership witness: the compare+deny lives in a CALLED
// helper (`assertOwner(row.ownerId, req.user.id)` / `assertOwner(row, req.user)`), so the
// inline verifier above never sees it. The call-site principal-binding hop: classify each
// argument at the CALL SITE (the caller's verified identity via `valueIsIdentity` — the same
// honesty gate as inline, `req.body.*` is never identity — vs a fetched value), bind each
// argument to the helper parameter it feeds, then require the HELPER BODY to deny behind a
// compare of an identity-bound param against a fetched-bound param (bare, or a member off it —
// `assertOwner(row, user)` comparing `row.ownerId !== user.id`). Recall needs the call site,
// soundness needs the helper body — NEITHER alone clears:
//   • no identity-classified argument (spoof: `assertOwner(row.ownerId, req.body.userId)`)
//     → false, the advisory stays;
//   • a helper that logs instead of denying, or denies without comparing the two bound
//     params (`if (owned !== 'admin') throw`) → false, the advisory stays.
// Feeds ONLY the O7 BOLA advisory (never a hard rule, never a guard — E-042 discipline), so a
// mis-clear can only drop a non-gating advisory, never create a false PROVEN.
function paramNamesOf(fnNode) {
  return (fnNode?.params ?? []).map((p) => {
    let id = p.type === 'TSParameterProperty' ? p.parameter : p;
    if (id?.type === 'AssignmentPattern') id = id.left;
    return id?.type === 'Identifier' ? id.name : null;
  });
}
// does this expression read a param in `set` — the bare identifier or a member off it?
function bindsParam(node, set) {
  node = unwrapTS(node);
  if (!node) return false;
  if (node.type === 'Identifier') return set.has(node.name);
  if (node.type !== 'MemberExpression') return false;
  const root = rootIdentifier(node);
  return root != null && set.has(root);
}
export function callBindsOwnershipWitness(callNode, fnNode) {
  const args = callNode?.arguments ?? [];
  const names = paramNamesOf(fnNode);
  const identityParams = new Set();
  const fetchedParams = new Set();
  args.forEach((a, i) => {
    const name = names[i];
    if (!name) return;
    const arg = unwrapTS(a);
    if (valueIsIdentity(arg)) identityParams.add(name);
    else if (arg?.type === 'MemberExpression' || arg?.type === 'Identifier')
      fetchedParams.add(name);
  });
  if (!identityParams.size || !fetchedParams.size) return false;
  let owns = false;
  walkNodes(fnNode.body, (node) => {
    if (node.type !== 'IfStatement' || !branchDenies(node.consequent)) return;
    walkNodes(node.test, (b) => {
      if (b.type !== 'BinaryExpression' || !/^[=!]==?$/.test(b.operator)) return;
      if (bindsParam(b.left, identityParams) && bindsParam(b.right, fetchedParams))
        owns = true;
      if (bindsParam(b.right, identityParams) && bindsParam(b.left, fetchedParams))
        owns = true;
    });
  });
  return owns;
}

// does this `where` target a specific object by a bare `id` key (the BOLA shape)?
function whereHasIdKey(whereNode) {
  if (whereNode?.type !== 'ObjectExpression') return false;
  let has = false;
  walkNodes(whereNode, (n) => {
    if (
      n.type === 'ObjectProperty' &&
      n.key?.type === 'Identifier' &&
      n.key.name === 'id'
    )
      has = true;
  });
  return has;
}
const src2 = (n) => (n.property?.type === 'Identifier' ? n.property.name : '');

// the raw value node of a named option in an options object — the `data` in
// `create({ data: <node> })`. Unlike prismaLiteralsOf (string literals only) this returns
// the payload node itself, so taint can be tested on it.
function optionValueOf(arg, name) {
  if (arg?.type !== 'ObjectExpression') return null;
  for (const p of arg.properties)
    if (
      p.type === 'ObjectProperty' &&
      p.key?.type === 'Identifier' &&
      p.key.name === name
    )
      return p.value;
  return null;
}

export function reqParamName(node, reqDerived, thisSymbols) {
  node = unwrapTS(node);
  if (node?.type === 'Identifier') return reqDerived?.get(node.name) ?? null;
  if (node?.type !== 'MemberExpression') return null;
  // leaf name: dot access (.collection) OR bracket access with a string key (['collection'])
  const leaf = node.computed
    ? node.property.type === 'StringLiteral'
      ? node.property.value
      : null
    : node.property.type === 'Identifier'
      ? node.property.name
      : null;
  if (!leaf) return null;
  // this.<field> resolved through the symbolic environment (cross-class dataflow)
  if (node.object.type === 'ThisExpression') return thisSymbols?.get(leaf) ?? null;
  const root = rootIdentifier(node);
  if (!root || !REQ_ROOTS.has(root.toLowerCase())) return null;
  return `:${leaf}`;
}

// map local vars assigned straight from a request member: `const c = req.params.collection`
// → { c: ':collection' }. Also follows the two commonest value-flow shapes the direct-member
// case misses — OBJECT DESTRUCTURING (`const { title, body } = req.body` → title/body carry
// the request taint, the dominant handler idiom) and IDENTIFIER ALIAS (`const b = req.body;
// const c = b`). One source-order pass — earlier bindings are in the map when a later one
// references them; deterministic; bounded by the function body. UNDER-approximates on
// purpose (a missed alias is a false-negative on an advisory taint tag, never a hidden
// write) — see valueTainted.
//
// `seed` (interprocedural, ADR-066): request-derived PARAMETER bindings supplied by the
// caller — when a handler calls `saveItem(req.body)`, the resolver seeds `saveItem`'s param
// as request-derived so a write inside it taints. Seeded first so a local re-binding in the
// body can still override. MUST-analysis: the caller only seeds a param it PROVED tainted.
export function collectReqDerived(fnNode, seed = null) {
  const map = new Map();
  if (seed) for (const [k, v] of seed) map.set(k, v);
  // non-null request-taint marker if `init` is request-derived: a req member (`req.body`),
  // or an identifier already tracked as request-derived (`b` after `const b = req.body`).
  const reqSourceOf = (init) => {
    const node = unwrapTS(init);
    if (!node) return null;
    if (node.type === 'Identifier') return map.get(node.name) ?? null;
    if (node.type === 'MemberExpression') return reqParamName(node, map);
    return null;
  };
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (n.type === 'VariableDeclarator') {
      if (n.id?.type === 'Identifier' && n.init?.type === 'MemberExpression') {
        const name = reqParamName(n.init, map);
        if (name) map.set(n.id.name, name);
      } else if (n.id?.type === 'Identifier' && n.init?.type === 'Identifier') {
        // alias: `const c = b` where b is already request-derived
        const src = map.get(n.init.name);
        if (src) map.set(n.id.name, src);
      } else if (n.id?.type === 'ObjectPattern' && reqSourceOf(n.init)) {
        // destructure: `const { title, body: b, ...rest } = req.body` — each binding is
        // request-derived; a named binding carries its KEY as the symbolic leaf (`:title`).
        const src = reqSourceOf(n.init);
        for (const prop of n.id.properties) {
          if (prop.type === 'RestElement' && prop.argument?.type === 'Identifier') {
            map.set(prop.argument.name, src); // rest carries the whole source taint
            continue;
          }
          if (prop.type !== 'ObjectProperty') continue;
          const key =
            prop.key?.type === 'Identifier'
              ? prop.key.name
              : prop.key?.type === 'StringLiteral'
                ? prop.key.value
                : null;
          // local binding: `{ title }` (value=title), `{ title: t }` (value=t),
          // `{ title = 'x' }` (value=AssignmentPattern → left)
          const val = prop.value;
          const local =
            val?.type === 'Identifier'
              ? val.name
              : val?.type === 'AssignmentPattern' && val.left?.type === 'Identifier'
                ? val.left.name
                : null;
          if (key && local) map.set(local, `:${key}`);
        }
      }
    }
    for (const k of Object.keys(n)) {
      if (
        k === 'loc' ||
        k === 'range' ||
        k === 'leadingComments' ||
        k === 'trailingComments'
      )
        continue;
      const v = n[k];
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(fnNode.body);
  return map;
}

// SBIR §2.2 — transaction wrappers whose function arguments open a scope
const TX_WRAPPERS = new Set(['transaction', '$transaction', 'withTransaction']);

// Mutating effect kinds — the ones a guard is supposed to dominate (O1). A read is never a bypass.
const MUTATING_EFFECTS = new Set(['db_write', 'http_call', 'fs_write']);

// Guard-DOMINANCE (kills the C2 false PROVEN): a guard on a route's chain does not make EVERY
// write on the route safe — the guard must run BEFORE the write. A handler that mutates in an
// early-return branch and only checks auth afterwards (`if (preview) { charge.create(); return }
// … await requireAuth(req)`) bypasses its own guard. We compute, per body, which mutations
// execute on a path that has not yet passed a guard, AND where a guard follows on the same spine
// (so there genuinely IS a guard being bypassed — a body whose guard lives cross-procedurally is
// left to the route-level model, unchanged). This can only ever SUBTRACT guard credit — it never
// invents a guard — so a heuristic barrier is sound: at worst it misses a bypass, never fabricates.
//
// A spine statement sets the barrier when everything sequentially after it has passed the check:
//   (a) an early-deny gate — `if (test) throw | return <4xx>` (fall-through ⇒ the check passed), or
//   (b) a guard CALL on the spine — `await requireAuth(req)` / `const s = await getSession()`.
function spineCall(stmt) {
  let e = null;
  if (stmt.type === 'ExpressionStatement') e = stmt.expression;
  else if (stmt.type === 'VariableDeclaration' && stmt.declarations[0])
    e = stmt.declarations[0].init;
  if (e?.type === 'AwaitExpression') e = e.argument;
  return e?.type === 'CallExpression' ? e : null;
}

// An AUTHORIZATION gate, tightly — NOT the broad GUARD_NAME (which matches business calls like
// `hasAdmin`/`getRole`/`verifyEmail` and would flood false bypasses). Only names that unambiguously
// gate access: `require/ensure/assert{Auth,Session,User,Owner,Permission,Role,Admin,Login,Access}`,
// `authenticate`/`authorize`, `canActivate`, `get(Server)Session`, `check/verify{Auth,Session,…}`.
const AUTH_GATE_CALL =
  /(^|[^a-z])(require|ensure|assert)[_]?(auth|session|user|owner|permission|role|admin|login|access)|authenticate|authoriz(e|ation)|can[_]?activate|get[_]?server[_]?session|get[_]?session|check[_]?(auth|permission|access|session)|verify[_]?(auth|session|permission)|protect[_]?route/i;

function isGuardCall(call) {
  const callee = call.callee;
  const name =
    callee?.type === 'Identifier'
      ? callee.name
      : callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier'
        ? callee.property.name
        : '';
  return AUTH_GATE_CALL.test(name);
}

// Does this subtree AUTH-deny — refuse with 401/403 or an auth exception? (Deliberately NOT any
// throw or any 4xx: a validation `throw new BadRequestException()` inside a service is not an auth
// gate, and treating it as one is what produced false bypasses.)
function subtreeAuthDenies(node) {
  let found = false;
  const walk = (n) => {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (n.type === 'CallExpression' && deniedStatusOf(n)) return void (found = true);
    if (n.type === 'NewExpression') {
      const nm = n.callee?.name;
      if (
        /^(Unauthorized|Forbidden)(Exception|Error)$/.test(nm ?? '') ||
        (Array.isArray(n.arguments) && n.arguments.some(isDenyOptions))
      )
        return void (found = true);
    }
    for (const k of Object.keys(n)) {
      if (
        k === 'loc' ||
        k === 'range' ||
        k === 'leadingComments' ||
        k === 'trailingComments'
      )
        continue;
      const v = n[k];
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(node);
  return found;
}

function statementSetsBarrier(stmt) {
  if (!stmt) return false;
  if (stmt.type === 'IfStatement') return subtreeAuthDenies(stmt.consequent);
  const call = spineCall(stmt);
  return call ? isGuardCall(call) : false;
}

function visit(node, out, ctx) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) visit(n, out, ctx);
    return;
  }

  // Ordered spine walk of a block, tracking whether a guard has executed ON THE CURRENT PATH. A
  // spine guard covers everything sequentially after it AND everything nested inside those later
  // statements; a guard INSIDE a branch covers only that branch, never a sibling. Each mutation
  // visited while the path is still unguarded is tagged `_unguardedPath` — a write reachable without
  // passing a guard. (scanFunction promotes those to `bypassesGuard` only when THIS body actually
  // has an in-body guard, so a body guarded cross-procedurally is left to the route model, unchanged.)
  if (node.type === 'BlockStatement') {
    let guarded = ctx.guarded === true;
    for (const stmt of node.body) {
      visit(stmt, out, { ...ctx, guarded });
      if (statementSetsBarrier(stmt)) {
        guarded = true;
        out.hasInBodyGuard = true;
      }
    }
    return;
  }

  // G2 credential signal (advisory-only): the body can refuse — any throw, or any 4xx
  // response. Deliberately BROADER than guardSignals.deniesWithStatus (401/403) because it
  // can only ever downgrade a critical to an advisory, never verify a guard.
  if (node.type === 'ThrowStatement') out.credentialSignals.denies4xxOrThrows = true;

  // G1b (O7/BOLA only): fetch-then-compare ownership — `if (row.ownerId !== req.user.id) deny`.
  // The deterministic witness verifier (ADR-074), clears the same advisory as G1 (callAssertsOwnership),
  // sound both ways. Runs on every IfStatement, so it must be in `visit`, not `inspectCall`.
  if (ifAssertsOwnership(node)) out.ownerAsserted = true;

  // try/catch — try-effects are compensable by catch-effects (SBIR §2.2)
  if (node.type === 'TryStatement') {
    const tryLine = node.loc?.start.line ?? 0;
    visit(node.block, out, { ...ctx, tryId: tryLine, catchOf: null });
    if (node.handler) visit(node.handler, out, { ...ctx, tryId: null, catchOf: tryLine });
    if (node.finalizer) visit(node.finalizer, out, ctx);
    return;
  }

  // Auth denial by exception — `throw new UnauthorizedException()` /
  // `ForbiddenException()` (Nest, and Nest-shaped frameworks), or `new HttpException(_,
  // 401|403)`. A body that CONSTRUCTS one of these can deny, exactly like res.status(401)
  // — so a resolved guard's canActivate reads as VERIFIED, not merely asserted by name.
  if (node.type === 'NewExpression' && node.callee?.type === 'Identifier') {
    const n = node.callee.name;
    if (/^(Unauthorized|Forbidden)(Exception|Error)$/.test(n))
      out.guardSignals.deniesWithStatus = true;
    else if (n === 'HttpException' || n === 'HttpError')
      for (const a of node.arguments)
        if (isDenyStatusArg(a)) out.guardSignals.deniesWithStatus = true;
    // any error/response CONSTRUCTED with an unauthorized/forbidden code or a 401/403
    // status — `new DubApiError({ code: "unauthorized" })`, `new Response(_, { status:
    // 403 })`. A general REST/Next idiom, so a resolved auth wrapper reads as a denial.
    if (node.arguments.some(isDenyOptions)) out.guardSignals.deniesWithStatus = true;
  }

  // `new Date()` — wall-clock read: an entropy effect the flight recorder
  // must tap for deterministic replay (SBIR v1.2 / Timeless)
  if (
    node.type === 'NewExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'Date' &&
    node.arguments.length === 0
  ) {
    pushEffect(out, ctx, {
      effectType: 'entropy',
      target: 'time',
      line: node.loc?.start.line ?? 0,
    });
  }

  // A TAGGED TEMPLATE is a call with template syntax: prisma.$executeRaw`DELETE …`
  // runs SQL exactly like prisma.$executeRawUnsafe('DELETE …'), but it is not a
  // CallExpression, so the whole effect used to disappear. Read the template's literal
  // parts as SQL when the tag is rooted at a proven persistence handle; if the SQL is
  // unreadable, fall back to the opaque-write net rather than dropping it.
  if (node.type === 'TaggedTemplateExpression') {
    taggedTemplateEffect(node, out, ctx);
  }

  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    // transaction scope: db.transaction(cb) / prisma.$transaction(...) — the
    // innermost scope wins; isolation only from a string literal, never guessed
    const callee = node.callee;
    if (
      callee?.type === 'MemberExpression' &&
      callee.property?.type === 'Identifier' &&
      TX_WRAPPERS.has(callee.property.name)
    ) {
      // Client-provenance (the "prion" bind): an interactive transaction hands its callback a
      // transactional client — `prisma.$transaction(async (tx) => { tx.order.create(...) })`. The
      // param `tx` IS a db client, but wears a name the /prisma|client|db/ heuristic can't see, so
      // every write inside used to VANISH (audit blind spot #3: the dominant Prisma idiom compiled
      // to SURFACE). We propagate the receiver's db-identity onto the callback param name for the
      // scope of the transaction — templated by contact, not by name. Scoped to txCtx, so the alias
      // never leaks past the transaction body.
      const cbParams = node.arguments
        .filter(
          (a) =>
            a?.type === 'ArrowFunctionExpression' || a?.type === 'FunctionExpression',
        )
        .flatMap((fn) => fn.params ?? [])
        .filter((p) => p?.type === 'Identifier')
        .map((p) => p.name);
      const txCtx = {
        ...ctx,
        tx: node.loc?.start.line ?? 0,
        isolation: isolationLiteralOf(node) ?? 'default',
        dbAliases: new Set([...(ctx.dbAliases ?? []), ...cbParams]),
      };
      for (const arg of node.arguments) visit(arg, out, txCtx);
      return;
    }
    inspectCall(node, out, ctx);
  }
  for (const k of Object.keys(node)) {
    if (
      k === 'loc' ||
      k === 'range' ||
      k === 'leadingComments' ||
      k === 'trailingComments'
    )
      continue;
    const v = node[k];
    if (v && typeof v === 'object') visit(v, out, ctx);
  }
}

// Prisma `isolationLevel: 'Serializable'` & friends — literal or nothing
function isolationLiteralOf(callNode) {
  for (const arg of callNode.arguments) {
    if (arg.type !== 'ObjectExpression') continue;
    for (const prop of arg.properties) {
      if (
        prop.type === 'ObjectProperty' &&
        ((prop.key.type === 'Identifier' && /^isolation(Level)?$/.test(prop.key.name)) ||
          (prop.key.type === 'StringLiteral' &&
            /^isolation(Level)?$/.test(prop.key.value))) &&
        prop.value.type === 'StringLiteral'
      )
        return prop.value.value.toLowerCase();
    }
  }
  return null;
}

function inspectCall(node, out, ctx) {
  const line = node.loc?.start.line ?? 0;
  const callee = node.callee;

  // ---- response shapes: res.json(x) / res.status(n).json(x) / Response.json(x)
  const jsonShape = responseJsonShape(node);
  if (jsonShape !== undefined) {
    if (out.returnShapes.length < MAX_RETURN_SHAPES && jsonShape !== null)
      out.returnShapes.push({ line, shape: jsonShape });
    if (deniedStatusOf(node)) out.guardSignals.deniesWithStatus = true;
    if (statusIn4xx(node)) out.credentialSignals.denies4xxOrThrows = true;
    return;
  }
  if (deniedStatusOf(node)) out.guardSignals.deniesWithStatus = true;
  if (statusIn4xx(node)) out.credentialSignals.denies4xxOrThrows = true;

  // G1 (O7/BOLA only): a call that asserts caller-ownership at the site scopes the path —
  // `getCustomerOrThrow({ workspaceId: workspace.id, id })`. Advisory-only, so it can never
  // create a false PROVEN; it silences the false BOLA the imported ownership helper would raise.
  if (callAssertsOwnership(node)) out.ownerAsserted = true;

  // G2 (advisory-only): a call whose NAME says it verifies a credential — `verifyUnsubscribeToken`,
  // `jwt.verify`, an HMAC/signature check. Family B/D of the guard taxonomy. Never a guard by
  // itself (E-042: a name fabricates nothing) — it only feeds the UNGUARDED downgrade.
  const verifyName =
    callee.type === 'Identifier'
      ? callee.name
      : callee.type === 'MemberExpression' && callee.property?.type === 'Identifier'
        ? callee.property.name
        : '';
  if (/verify|signature|hmac/i.test(verifyName)) out.credentialSignals.verifyCall = true;
  // OAuth/browser callbacks refuse by REDIRECTING away (family F) — no throw, no 4xx.
  // Only ever consulted for callback-shaped routes, and only to downgrade to advisory.
  if (verifyName === 'redirect') out.credentialSignals.redirects = true;
  // A named REFUSAL helper is the dominant Next.js / App-Router idiom — the deny is a call like
  // `responses.notAuthenticatedResponse()` / `unauthorized()` / `throwForbidden()`, never a literal
  // `res.status(401)` or a bare `throw`, so statusIn4xx and the ThrowStatement check both miss it.
  // The refusal is real; only its spelling is a helper. Advisory-only (feeds the UNGUARDED
  // downgrade, never a guard): a route still needs a matching credential FAMILY to downgrade, so a
  // plain 404 helper on an ordinary route changes nothing.
  if (
    /(not_?authenticated|un_?authenticated|not_?authori[sz]ed|un_?authori[sz]ed|forbidden|access_?denied|bad_?request|too_?many_?requests|rate_?limit(ed|_?exceeded)?|missing_?fields|unprocessable|invalid_?(api_?key|token|credential|secret|request|permission))/i.test(
      verifyName,
    )
  )
    out.credentialSignals.denies4xxOrThrows = true;

  // ---- local calls: bare identifier calls → call-graph edges later
  if (callee.type === 'Identifier') {
    if (callee.name === 'fetch') {
      const httpMethod = optionsMethodOf(node);
      pushEffect(out, ctx, {
        effectType: 'http_call',
        target: literalArg(node.arguments[0]) ?? 'dynamic',
        ...(httpMethod ? { httpMethod } : {}),
        line,
      });
      return;
    }
    if (/^(uuid|uuidv4|nanoid|randomuuid|ulid)$/i.test(callee.name)) {
      pushEffect(out, ctx, { effectType: 'entropy', target: 'uuid', line });
      return;
    }
    if (out.calls.length < MAX_CALLS) out.calls.push({ name: callee.name, line });
    return;
  }

  // Optional chaining is the SAME call: `prisma?.note?.deleteMany()` deletes exactly
  // what `prisma.note.deleteMany()` deletes whenever the handle exists, which it does
  // in any app that boots. Babel gives it a distinct node type, and matching only the
  // plain form made the write vanish from the graph entirely.
  if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') {
    // A receiver that is not a member at all — `(cond ? a : b).deleteMany()`,
    // `getClient().wipe()` — cannot be named statically. If anything inside it is a
    // proven persistence handle, the call is treated as a write rather than dropped.
    opaqueDynamicWrite(node, out, ctx, callee, line);
    return;
  }
  // A COMPUTED member — `prisma.note[OP]()`, `db['delete' + 'Many']()` — has no
  // statically-known method name, so every name-driven ORM/SDK handler below is
  // blind to it. Bailing out here (which is what the old `property.type !==
  // 'Identifier'` guard did) meant the call produced NO effect at all: a mass
  // delete on a proven database handle simply did not exist in the graph, and the
  // route around it read as a harmless no-op (Z4). Dynamic calls fall through to
  // the opaque-write net at the bottom, which is provenance-based and needs no
  // method name.
  const dynamicMember = callee.computed || callee.property.type !== 'Identifier';
  if (dynamicMember) {
    opaqueDynamicWrite(node, out, ctx, callee, line);
    return;
  }
  const method = callee.property.name;
  const methodLower = method.toLowerCase();
  const rootName = rootIdentifier(callee);

  // ---- entropy: nondeterminism points the replayer must virtualize
  if (rootName === 'Date' && methodLower === 'now') {
    pushEffect(out, ctx, { effectType: 'entropy', target: 'time', line });
    return;
  }
  if (rootName === 'Math' && methodLower === 'random') {
    pushEffect(out, ctx, { effectType: 'entropy', target: 'random', line });
    return;
  }
  if (/^crypto$/i.test(rootName ?? '') && methodLower === 'randomuuid') {
    pushEffect(out, ctx, { effectType: 'entropy', target: 'uuid', line });
    return;
  }

  // ---- input validation signal (SBIR §2.1): zod-style .safeParse / Schema.parse
  if (
    methodLower === 'safeparse' ||
    (methodLower === 'parse' &&
      callee.object.type === 'Identifier' &&
      /schema$/i.test(callee.object.name))
  ) {
    out.validatesInput = true;
    return;
  }

  // ---- raw SQL: X.query('INSERT ...') / X.execute(`SELECT ...`)
  if ((methodLower === 'query' || methodLower === 'execute') && node.arguments.length) {
    const sql = literalArg(node.arguments[0]);
    if (sql) {
      const parsed = parseSqlCall(sql);
      if (parsed) {
        pushEffect(out, ctx, { ...parsed, line, driver: rootName ?? 'unknown' });
        return;
      }
    }
    pushEffect(out, ctx, {
      effectType: 'db_read',
      op: 'unknown',
      table: null,
      line,
      driver: rootName ?? 'unknown',
    });
    return;
  }

  // ---- kysely builder: db.insertInto('t').values(...) / .updateTable('t').set(...)
  // / .deleteFrom('t') / .selectFrom('t'). The table is the op's OWN string arg
  // (not a chained .from()), so read it straight off arguments[0].
  if (KYSELY_OPS[methodLower] !== undefined && callee.type === 'MemberExpression') {
    const arg0 = node.arguments[0];
    const literal = arg0?.type === 'StringLiteral' ? arg0.value.toLowerCase() : null;
    const resolved = literal ?? reqParamName(arg0, ctx.reqDerived, ctx.thisSymbols);
    if (resolved) {
      const op = KYSELY_OPS[methodLower];
      pushEffect(out, ctx, {
        effectType: op === 'select' ? 'db_read' : 'db_write',
        op,
        table: resolved,
        ...(resolved.startsWith(':') ? { symbolic: true } : {}),
        line,
      });
      return;
    }
  }

  // ---- supabase/knex builder: X.from('t').insert(...) or knex('t').update(...)
  if (SUPABASE_OPS.has(methodLower)) {
    const resolved = builderTableOf(callee.object, ctx.reqDerived, ctx.thisSymbols);
    if (resolved) {
      pushEffect(out, ctx, {
        effectType: methodLower === 'select' ? 'db_read' : 'db_write',
        op: methodLower,
        table: resolved.symbolic ? resolved.table : resolved.table.toLowerCase(),
        ...(resolved.symbolic ? { symbolic: true } : {}),
        ...(methodLower !== 'select' && valueTainted(node.arguments[0], ctx)
          ? { tainted: true }
          : {}),
        line,
      });
      return;
    }
  }

  // ---- knex verb-first order: `knex.select(...).from('t')` / `knex.insert(d).into('t')`.
  // Here the table is named AFTER the verb (in .from()/.into()), so builderTableOf — which
  // walks BACKWARD from the verb — can't see it. Handle it at the .from()/.into() call: the
  // verb sits in THIS call's receiver chain, which cleanly distinguishes it from supabase's
  // `.from('t').select()` (verb in the PARENT, resolved above) — so no double-count. A
  // db-ish root is required, so `Array.from(x)` and friends never fire.
  if (methodLower === 'from' || methodLower === 'into') {
    const arg0 = node.arguments[0];
    const literal = arg0?.type === 'StringLiteral' ? arg0.value.toLowerCase() : null;
    const resolved = literal ?? reqParamName(arg0, ctx.reqDerived, ctx.thisSymbols);
    const op = resolved ? chainVerbOp(callee.object) : null;
    if (op) {
      pushEffect(out, ctx, {
        effectType: op === 'select' ? 'db_read' : 'db_write',
        op,
        table: resolved,
        ...(resolved.startsWith(':') ? { symbolic: true } : {}),
        line,
      });
      return;
    }
  }

  // ---- TypeORM: `repo.save(dto)` / `this.userRepo.update(...)` / `manager.remove(...)`. Fires
  // ONLY when the receiver is a known repository (ctx.repoTables — injected/typed repo field or a
  // local getRepository(Entity) var), so a generic `.save()`/`.update()` never trips it. The table
  // is the entity the repo is typed to; a repo with no resolvable entity still yields a db_write
  // with an unknown table (enough for O1 guard checks and to lift the handler off SURFACE).
  if (TYPEORM_WRITE[methodLower] !== undefined && ctx.repoTables) {
    const recv =
      callee.object.type === 'Identifier' || callee.object.type === 'MemberExpression'
        ? clientBaseName(callee.object)
        : null;
    if (recv && ctx.repoTables.has(recv)) {
      const table = ctx.repoTables.get(recv);
      pushEffect(out, ctx, {
        effectType: 'db_write',
        op: TYPEORM_WRITE[methodLower],
        table: table || null,
        ...(valueTainted(node.arguments[0], ctx) ? { tainted: true } : {}),
        line,
      });
      return;
    }
  }

  // ---- prisma: prisma.user.findMany() → table "user". Literal values in
  // `data:`/`where:` are harvested like SQL SET/WHERE literals — they are the
  // raw material StateMachineInference reads (lowercased, same trade-off)
  if (PRISMA_OPS[methodLower] !== undefined) {
    const obj = callee.object;
    // `prisma.user.create(...)` OR the class-based `this.prisma.user.create(...)`
    // that NestJS services / Express controller classes use — `clientBaseName`
    // reads the client name off a bare Identifier or a `this.<field>`.
    // optional chaining is the same access: `prisma?.user?.create(…)` writes exactly
    // what `prisma.user.create(…)` writes whenever the handle exists
    const objIsMember =
      obj?.type === 'MemberExpression' || obj?.type === 'OptionalMemberExpression';
    const client = objIsMember ? clientBaseName(obj.object) : null;
    if (
      objIsMember &&
      !obj.computed &&
      obj.property.type === 'Identifier' &&
      client &&
      (/prisma|client|db/i.test(client) || ctx.dbAliases?.has(client))
    ) {
      const op = PRISMA_OPS[methodLower];
      const data = prismaLiteralsOf(node.arguments[0], 'data');
      const where = prismaLiteralsOf(node.arguments[0], 'where');
      const whereNode = optionValueOf(node.arguments[0], 'where');
      pushEffect(out, ctx, {
        effectType: op === 'select' ? 'db_read' : 'db_write',
        op,
        table: obj.property.name.toLowerCase(),
        ...(data && op === 'insert' ? { inserts: data } : {}),
        ...(data && op !== 'insert' && op !== 'select' ? { sets: data } : {}),
        ...(where ? { where } : {}),
        ...(op !== 'select' && valueTainted(optionValueOf(node.arguments[0], 'data'), ctx)
          ? { tainted: true }
          : {}),
        // ADR-058 B: object-scope provenance — a query targeting a bare `id`, and whether
        // it is scoped to the caller (an ownership key / a session value). Feeds BOLA.
        ...(whereNode && whereHasIdKey(whereNode) ? { idScoped: true } : {}),
        ...(whereNode && whereOwnerScoped(whereNode) ? { ownerScoped: true } : {}),
        line,
      });
      return;
    }
  }

  // ---- drizzle: db.insert(users).values(...) / db.update(users) / db.delete(users).
  // The table is the schema-object IDENTIFIER passed to the op (not a string). Only a
  // db-like receiver qualifies, so it never fires on an arbitrary `.insert()`.
  if (DRIZZLE_OPS[methodLower] !== undefined && callee.type === 'MemberExpression') {
    const recv =
      callee.object.type === 'Identifier'
        ? callee.object.name
        : clientBaseName(callee.object);
    const arg0 = node.arguments[0];
    if (
      recv &&
      /^(db|database|drizzle|tx|trx|conn|client)$/i.test(recv) &&
      arg0?.type === 'Identifier'
    ) {
      pushEffect(out, ctx, {
        effectType: 'db_write',
        op: DRIZZLE_OPS[methodLower],
        table: arg0.name.toLowerCase(),
        line,
      });
      return;
    }
  }

  // ---- active-record ORM: User.create(...) / User.findAll(...) / User.save(...) — a
  // Capitalized model receiver with a known op (Mongoose / TypeORM active-record /
  // Sequelize). Capitalization is the shared convention and keeps this from firing on
  // `Math.random()`-style utility calls. Repository-pattern (`userRepository.save()`) is
  // deliberately NOT matched here — in Nest it is reached through DI into the repo
  // method's real query, so matching it too would double-count.
  if (
    MODEL_OPS[methodLower] !== undefined &&
    callee.object.type === 'Identifier' &&
    /^[A-Z]/.test(callee.object.name) &&
    !NON_MODEL_RECEIVER.test(callee.object.name)
  ) {
    const op = MODEL_OPS[methodLower];
    pushEffect(out, ctx, {
      effectType: op === 'select' ? 'db_read' : 'db_write',
      op,
      table: callee.object.name.toLowerCase(),
      ...(op !== 'select' && valueTainted(node.arguments[0], ctx)
        ? { tainted: true }
        : {}),
      line,
    });
    return;
  }

  // ---- innate immunity: known vendor-SDK effects (stripe.charges.create, transporter.sendMail…)
  // that carry no http-client skin. Checked AFTER every DB handler has returned, so an ORM call
  // is never misread as an SDK effect. See EFFECT_SDK_PATHS.
  const sdkEffect = knownExternalEffect(callee, methodLower, node);
  if (sdkEffect) {
    pushEffect(out, ctx, { effectType: 'http_call', ...sdkEffect, line });
    return;
  }
  // Import-provenance: a call whose ROOT binding was labeled an effect client (imported from a
  // payment/mail/cloud/queue package, or built from one). Recognized by origin, not method name —
  // this is what catches the bare `.send()` tail (sgMail.send, producer.send). A read-shaped
  // method stays GET (not observable); config/wiring methods emit nothing.
  if (
    rootName &&
    ctx.effectClients?.has(rootName) &&
    !SDK_IGNORE_METHOD.has(methodLower)
  ) {
    pushEffect(out, ctx, {
      effectType: 'http_call',
      target: `sdk:${rootName}.${methodLower}`,
      httpMethod: SDK_READ_METHOD.test(methodLower) ? 'GET' : 'POST',
      line,
    });
    return;
  }

  // ---- HTTP clients: axios.get(...), got.post(...) — the member IS the method
  if (rootName && HTTP_CLIENTS.has(rootName.toLowerCase())) {
    const httpMethod = /^(get|post|put|patch|delete|head)$/.test(methodLower)
      ? methodLower.toUpperCase()
      : optionsMethodOf(node);
    pushEffect(out, ctx, {
      effectType: 'http_call',
      target: literalArg(node.arguments[0]) ?? 'dynamic',
      ...(httpMethod ? { httpMethod } : {}),
      line,
    });
    return;
  }

  // ---- filesystem: fs.writeFileSync(...), fs.promises.readFile(...)
  if (rootName === 'fs' || rootName === 'fsp' || rootName === 'fsPromises') {
    if (FS_WRITE.has(methodLower)) {
      pushEffect(out, ctx, {
        effectType: 'fs_write',
        target: literalArg(node.arguments[0]) ?? 'dynamic',
        line,
      });
    } else if (FS_READ.has(methodLower)) {
      pushEffect(out, ctx, {
        effectType: 'fs_read',
        target: literalArg(node.arguments[0]) ?? 'dynamic',
        line,
      });
    }
    return;
  }

  // ---- opaque write on a PROVEN persistence handle (ADR-068 — the effect-bias inversion).
  // Reached only AFTER every known ORM/SDK/HTTP/fs handler has declined. An UNKNOWN method called
  // DIRECTLY on a database handle (`db.archiveAll(...)`) can't be read — but the safe direction is
  // INVERTED here vs everywhere else: a missed write is a HIDDEN HOLE (an unguarded custom write
  // goes invisible), while an over-flagged read is only a surfaceable false positive. So treat it
  // as a write. Marked `opaque` with a null table, so it fires ONLY the guard obligation (O1) and
  // NEVER fabricates column/atomicity precision (O2/O3 skip a table-less write). Gated hard to
  // avoid a flood: the receiver must be a handle IDENTIFIER (builder continuations sit on a CALL
  // receiver, ORM verbs are handled above), and the method must be neither a known read nor
  // plumbing. Provenance-based (dbHandles), never a name test — so this can only RAISE a finding.
  // The receiver is a handle when it IS one (`db.archiveAll()`) or when the handle is
  // unreachable by name but present in the receiver expression — `(a ? db : db).wipe()`,
  // `(await getDb()).wipe()`. The second form used to fall through to nothing at all.
  const handleReceiver =
    ctx.dbHandles &&
    (callee.object.type === 'Identifier' && ctx.dbHandles.has(callee.object.name)
      ? callee.object.name
      : callee.object.type !== 'Identifier'
        ? handleInSubtree(callee.object, ctx.dbHandles)
        : null);
  if (
    handleReceiver &&
    !DB_KNOWN_READ.has(methodLower) &&
    !DB_NON_EFFECT.has(methodLower)
  ) {
    pushEffect(out, ctx, {
      effectType: 'db_write',
      op: 'unknown',
      table: null,
      opaque: true,
      line,
    });
  }
}

// The dynamic sibling of the ADR-068 opaque-write net. A call whose METHOD cannot be
// read statically, made on a receiver rooted at a PROVEN persistence handle, is treated
// as a write — the same effect-bias inversion, for the same reason: a missed write is a
// hidden hole (an unguarded mass delete goes invisible), while an over-classified read is
// only a surfaceable false positive. Rooted, not direct: `prisma.note[OP]()` reaches the
// handle through the model member, which is exactly the dominant ORM shape.
//
// Bounded by provenance (dbHandles is built from imports/constructors, never from names)
// and by the rarity of computed calls, so it cannot flood. Write-only in effect: it can
// RAISE the guard obligation, never discharge one, never fabricate a PROVEN.
function opaqueDynamicWrite(node, out, ctx, callee, line) {
  if (!ctx?.dbHandles) return;
  const root = rootIdentifier(callee) ?? handleInSubtree(callee, ctx.dbHandles);
  if (!root || !ctx.dbHandles.has(root)) return;
  pushEffect(out, ctx, {
    effectType: 'db_write',
    op: 'unknown',
    table: null,
    opaque: true,
    dynamicMember: true,
    line,
  });
}

// A receiver with no nameable root — `(cond ? a : b).deleteMany()`, `(await get()).wipe()`.
// If a PROVEN persistence handle appears anywhere inside it, the call runs on a database,
// and the effect-bias inversion says treat it as a write rather than lose it. Bounded walk.
function handleInSubtree(node, handles, budget = { n: 400 }) {
  if (!node || typeof node !== 'object' || budget.n-- <= 0) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = handleInSubtree(n, handles, budget);
      if (hit) return hit;
    }
    return null;
  }
  if (node.type === 'Identifier' && handles.has(node.name)) return node.name;
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
    const v = node[k];
    if (v && typeof v === 'object') {
      const hit = handleInSubtree(v, handles, budget);
      if (hit) return hit;
    }
  }
  return null;
}

// prisma.$executeRaw`DELETE FROM "Note"` — a call wearing template syntax. Reads the
// template's STATIC parts as SQL (interpolations are holes, which is exactly what the
// SQL parser already tolerates); if the statement cannot be classified, the call still
// becomes an opaque write, because a raw-SQL tag on a proven handle is never a no-op.
function taggedTemplateEffect(node, out, ctx) {
  if (!ctx?.dbHandles) return;
  const tag = node.tag;
  const root =
    tag?.type === 'Identifier'
      ? tag.name
      : (rootIdentifier(tag) ?? handleInSubtree(tag, ctx.dbHandles));
  if (!root || !ctx.dbHandles.has(root)) return;
  const line = node.loc?.start.line ?? 0;
  const sql = (node.quasi?.quasis ?? []).map((q) => q.value?.cooked ?? '').join(' ? ');
  const parsed = sql ? parseSqlCall(sql) : null;
  if (parsed) {
    pushEffect(out, ctx, { ...parsed, line, driver: root });
    return;
  }
  pushEffect(out, ctx, {
    effectType: 'db_write',
    op: 'unknown',
    table: null,
    opaque: true,
    dynamicMember: true,
    line,
  });
}

function pushEffect(out, ctx, effect) {
  if (out.effects.length >= MAX_EFFECTS) return;
  if (ctx?.tx != null) {
    effect.txLine = ctx.tx;
    effect.txIsolation = ctx.isolation;
  }
  if (ctx?.tryId != null) effect.tryId = ctx.tryId;
  if (ctx?.catchOf != null) effect.catchOf = ctx.catchOf;
  // guard-dominance (C2): a mutation reached while no guard has run on this path. Temporary — promoted
  // to `bypassesGuard` in scanFunction only if this body also HAS a guard (else it is left unchanged).
  if (ctx?.guarded !== true && MUTATING_EFFECTS.has(effect.effectType))
    effect._unguardedPath = true;
  out.effects.push(effect);
}

// prisma.order.update({ where: { status: 'PENDING' }, data: { status: 'PAID' } })
// → string-literal pairs of the named option, lowercased, bounded like SQL
function prismaLiteralsOf(arg, optionName) {
  if (arg?.type !== 'ObjectExpression') return null;
  for (const prop of arg.properties) {
    if (
      prop.type !== 'ObjectProperty' ||
      prop.key.type !== 'Identifier' ||
      prop.key.name !== optionName ||
      prop.value.type !== 'ObjectExpression'
    )
      continue;
    const pairs = {};
    for (const field of prop.value.properties) {
      if (Object.keys(pairs).length >= 8) break;
      if (
        field.type === 'ObjectProperty' &&
        field.key.type === 'Identifier' &&
        field.value.type === 'StringLiteral'
      )
        pairs[field.key.name.toLowerCase()] = field.value.value.toLowerCase();
    }
    return Object.keys(pairs).length ? pairs : null;
  }
  return null;
}

// fetch(url, { method: 'POST' }) — literal method option or nothing (SBIR §2.4)
function optionsMethodOf(callNode) {
  for (const arg of callNode.arguments) {
    if (arg.type !== 'ObjectExpression') continue;
    for (const prop of arg.properties) {
      if (
        prop.type === 'ObjectProperty' &&
        ((prop.key.type === 'Identifier' && prop.key.name === 'method') ||
          (prop.key.type === 'StringLiteral' && prop.key.value === 'method')) &&
        prop.value.type === 'StringLiteral'
      )
        return prop.value.value.toUpperCase();
    }
  }
  return null;
}

// res.json(x), res.status(201).json(x), Response.json(x), NextResponse.json(x),
// res.send(objectLiteral) — returns the extracted shape (object → keys+types,
// non-object → null meaning "responds, shape unknown"), or undefined if the
// call is not a response at all.
function responseJsonShape(node) {
  const callee = node.callee;
  if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier')
    return undefined;
  const m = callee.property.name;
  if (m !== 'json' && m !== 'send') return undefined;

  const obj = callee.object;
  const isResponseClass =
    obj.type === 'Identifier' && /^(Response|NextResponse)$/.test(obj.name);
  const isResLike =
    (obj.type === 'Identifier' && /^(res|response|reply)$/i.test(obj.name)) ||
    (obj.type === 'CallExpression' && // res.status(n).json(x)
      obj.callee?.type === 'MemberExpression' &&
      obj.callee.property?.name === 'status');
  if (!isResponseClass && !isResLike) return undefined;
  if (m === 'send' && node.arguments[0]?.type !== 'ObjectExpression') return null;
  return objectShapeOf(node.arguments[0]);
}

// res.status(401|403) anywhere in the chain → guard denial signal
// An options/error-shape object that itself carries a denial: `{ status: 401 }`,
// `{ statusCode: 403 }`, or a semantic `{ code: "unauthorized" | "forbidden" }`. The
// last is how framework error classes (dub's DubApiError, many REST kits) encode auth
// denial — the numeric status is applied downstream, but the *intent* is provable here.
function isDenyOptions(arg) {
  if (arg?.type !== 'ObjectExpression') return false;
  for (const p of arg.properties) {
    if (p.type !== 'ObjectProperty' || p.key?.type !== 'Identifier') continue;
    if (p.key.name === 'status' || p.key.name === 'statusCode') {
      // { status: 403 } OR { status: HttpStatus.FORBIDDEN } (named constant, ADR-073)
      if (isDenyStatusArg(p.value)) return true;
    } else if (p.key.name === 'code') {
      if (
        p.value?.type === 'StringLiteral' &&
        /^(unauthorized|forbidden)$/i.test(p.value.value)
      )
        return true;
    }
  }
  return false;
}

// G2 (advisory-only): ANY 4xx refusal — broader than deniedStatusOf's 401/403 on purpose.
// A stored-token flow refuses with 400/404/410 as often as 401; since this signal can only
// downgrade a critical to an advisory (never verify a guard), the width is safe.
function statusIn4xx(node) {
  const is4xx = (v) => typeof v === 'number' && v >= 400 && v < 500;
  const inArgs = (args) =>
    (args ?? []).some(
      (a) =>
        a?.type === 'ObjectExpression' &&
        a.properties.some(
          (p) =>
            p.type === 'ObjectProperty' &&
            p.key?.name === 'status' &&
            p.value?.type === 'NumericLiteral' &&
            is4xx(p.value.value),
        ),
    );
  let cur = node;
  while (cur) {
    if (cur.type === 'CallExpression') {
      const m =
        cur.callee?.type === 'MemberExpression' ? cur.callee.property?.name : null;
      if (
        (m === 'status' || m === 'sendStatus') &&
        cur.arguments[0]?.type === 'NumericLiteral' &&
        is4xx(cur.arguments[0].value)
      )
        return true;
      if (m === 'json' && inArgs(cur.arguments)) return true;
    }
    cur =
      cur.callee?.type === 'MemberExpression' &&
      cur.callee.object?.type === 'CallExpression'
        ? cur.callee.object
        : null;
  }
  return false;
}

// A deny STATUS argument: the numeric 401/403, OR the named HTTP constant `X.FORBIDDEN` /
// `X.UNAUTHORIZED` (http-status-codes' `StatusCodes.FORBIDDEN`, Nest's `HttpStatus.FORBIDDEN`, …).
// The status NAME is a conserved denial signal regardless of spelling — recognizing it is honest
// (FORBIDDEN is 403 by definition, not a fuzzy name), and closes a huge real gap: a guard that
// throws `new HttpException(_, StatusCodes.FORBIDDEN)` (ghostfolio does this on 91 permission guards)
// used to read asserted only because SPARDA saw the constant, not a literal 403 (ADR-073).
const isDenyStatusArg = (a) =>
  (a?.type === 'NumericLiteral' && (a.value === 401 || a.value === 403)) ||
  (a?.type === 'MemberExpression' &&
    a.property?.type === 'Identifier' &&
    (a.property.name === 'FORBIDDEN' || a.property.name === 'UNAUTHORIZED'));

function deniedStatusOf(node) {
  // NextResponse.json(_, { status: 401 }) / res.json(_, { status: 403 }) — the deny is
  // in the init object, not a .status() chain. A first-class Next/Web-Response idiom.
  if (
    node.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.property?.name === 'json' &&
    node.arguments.some(isDenyOptions)
  )
    return true;
  // res.sendStatus(401) / res.status(401)... — a direct deny status (numeric or named constant)
  if (
    node.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.property?.name === 'sendStatus' &&
    isDenyStatusArg(node.arguments[0])
  )
    return true;
  let cur = node;
  while (cur) {
    if (
      cur.type === 'CallExpression' &&
      cur.callee?.type === 'MemberExpression' &&
      cur.callee.property?.name === 'status' &&
      isDenyStatusArg(cur.arguments[0])
    )
      return true;
    cur =
      cur.callee?.type === 'MemberExpression' &&
      cur.callee.object?.type === 'CallExpression'
        ? cur.callee.object
        : null;
  }
  return false;
}

// A visible middleware that is a pure unconditional pass-through — `(req,res,next) =>
// next()` or `function(req,res,next){ next() }` — cannot deny anything: it is a NO-OP
// guard (a disabled/stubbed auth). Narrow by design: any conditional, throw, deny, or
// other work means it is NOT a no-op (a real guard, or a delegating one, stays a guard).
export function isNoOpGuard(fnNode) {
  if (!fnNode) return false;
  const body = fnNode.body;
  // arrow with expression body: `(...)=> next()`
  if (body && body.type !== 'BlockStatement') return isBareNextCall(body);
  const stmts = (body?.body ?? []).filter((s) => s.type !== 'EmptyStatement');
  if (stmts.length !== 1) return false;
  const s = stmts[0];
  const expr =
    s.type === 'ExpressionStatement'
      ? s.expression
      : s.type === 'ReturnStatement'
        ? s.argument
        : null;
  return isBareNextCall(expr);
}
function isBareNextCall(node) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'next' &&
    node.arguments.length === 0
  );
}

// { a: 1, b: x, c: 'y' } → { a: 'number', b: 'unknown:x', c: 'string' }
// Identifiers keep their name behind 'unknown:' so TypePropagation can later
// resolve them against input params and state columns.
export function objectShapeOf(node) {
  if (!node) return null;
  if (node.type !== 'ObjectExpression') return null;
  const shape = {};
  for (const prop of node.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    const key =
      prop.key.type === 'Identifier'
        ? prop.key.name
        : prop.key.type === 'StringLiteral'
          ? prop.key.value
          : null;
    if (!key) continue;
    shape[key] = valueTypeOf(prop.value);
  }
  return shape;
}

function valueTypeOf(v) {
  switch (v.type) {
    case 'StringLiteral':
    case 'TemplateLiteral':
      return 'string';
    case 'NumericLiteral':
      return 'number';
    case 'BooleanLiteral':
      return 'boolean';
    case 'NullLiteral':
      return 'null';
    case 'ArrayExpression':
      return 'array';
    case 'ObjectExpression':
      return 'object';
    case 'Identifier':
      return `unknown:${v.name}`;
    case 'MemberExpression':
      return v.property?.type === 'Identifier' ? `unknown:${v.property.name}` : 'unknown';
    default:
      return 'unknown';
  }
}

function literalArg(arg) {
  if (!arg) return null;
  if (arg.type === 'StringLiteral') return arg.value;
  if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0)
    return arg.quasis[0]?.value.cooked ?? null;
  if (arg.type === 'TemplateLiteral')
    return arg.quasis.map((q) => q.value.cooked).join('*');
  return null;
}

function rootIdentifier(memberExpr) {
  let cur = memberExpr;
  while (cur?.type === 'MemberExpression' || cur?.type === 'OptionalMemberExpression') {
    // `this.foo.bar()` — the effective root is the class field `foo`, so
    // class-based access (NestJS services, controller classes) is read like a
    // bare `foo.bar()`. Without this, everything rooted at `this` is invisible.
    if (cur.object.type === 'ThisExpression')
      return cur.property.type === 'Identifier' ? cur.property.name : null;
    cur = cur.object;
  }
  return cur?.type === 'Identifier' ? cur.name : null;
}

// the name a member/identifier refers to, unwrapping `this.<field>` → `<field>`.
function clientBaseName(node) {
  if (node.type === 'Identifier') return node.name;
  if (
    node.type === 'MemberExpression' &&
    node.object.type === 'ThisExpression' &&
    node.property.type === 'Identifier'
  )
    return node.property.name;
  return null;
}

// The db op named in a verb-first builder chain whose table is in a trailing
// .from()/.into(): walk the receiver BACKWARD for a known verb, requiring a db-ish
// root so `Array.from`/`Object.from` never register. → 'select'|'insert'|… or null.
const READ_VERBS = new Set([
  'select',
  'find',
  'max',
  'min',
  'count',
  'avg',
  'sum',
  'first',
  'pluck',
  'distinct',
  'column',
  'columns',
]);
const WRITE_VERBS = {
  insert: 'insert',
  update: 'update',
  delete: 'delete',
  del: 'delete',
  upsert: 'upsert',
};
const DB_ROOT = /^(knex|db|database|trx|tx|conn|connection|client|qb|query|builder)$/i;

function chainVerbOp(node) {
  let cur = node;
  let op = null;
  let root = null;
  for (let hops = 0; hops < 10 && cur; hops++) {
    if (cur.type === 'CallExpression') {
      const c = cur.callee;
      if (c.type === 'MemberExpression' && c.property.type === 'Identifier') {
        const m = c.property.name.toLowerCase();
        if (!op) op = READ_VERBS.has(m) ? 'select' : (WRITE_VERBS[m] ?? null);
        cur = c.object.type === 'ThisExpression' ? null : c.object;
        if (c.object.type === 'ThisExpression') root = c.property.name;
      } else if (c.type === 'Identifier') {
        root = c.name;
        cur = null;
      } else cur = null;
    } else if (cur.type === 'MemberExpression') {
      if (cur.object.type === 'ThisExpression') {
        root = cur.property.name;
        cur = null;
      } else cur = cur.object;
    } else if (cur.type === 'Identifier') {
      root = cur.name;
      cur = null;
    } else cur = null;
  }
  return op && root && DB_ROOT.test(root) ? op : null;
}

// knex('users') → users ; supabase.from('users') → users ;
// supabase.from('users').select() chains: walk member/call chain to a
// .from('t') or a base call with a string literal argument.
// → { table, symbolic } or null. A request-derived arg (`knex(req.params.table)`,
// `.from(collection)` where `const collection = req.params.collection`) resolves to a
// SYMBOLIC table (`:table`) — a precise rule, not an unknown — so generic CRUD
// endpoints stop reading as blind.
function builderTableOf(node, reqDerived, thisSymbols) {
  let cur = node;
  const lit = (t) => ({ table: t, symbolic: false });
  for (let hops = 0; hops < 8 && cur; hops++) {
    if (cur.type === 'CallExpression') {
      const c = cur.callee;
      const arg0 = cur.arguments[0];
      // .from('t') / .into('t') — knex read source and insert target both name the table
      const isTableMethod =
        c.type === 'MemberExpression' &&
        c.property.type === 'Identifier' &&
        (c.property.name === 'from' || c.property.name === 'into');
      const isBaseCall = c.type === 'Identifier'; // knex('users') / trx('users')
      const isThisCall =
        c.type === 'MemberExpression' && c.object.type === 'ThisExpression';
      if (isTableMethod || isBaseCall || isThisCall) {
        if (arg0?.type === 'StringLiteral') return lit(arg0.value);
        const v = reqParamName(arg0, reqDerived, thisSymbols);
        if (v) return { table: v, symbolic: v.startsWith(':') };
      }
      cur = c.type === 'MemberExpression' ? c.object : null;
    } else if (cur.type === 'MemberExpression') {
      cur = cur.object;
    } else return null;
  }
  return null;
}

// 'INSERT INTO users (a) VALUES (1)' → { effectType, op, table, … }
// Literal column values are also harvested (SET x = 'v', WHERE x = 'v',
// INSERT (…) VALUES (…)) — the raw material StateMachineInference reads.
// Everything is lowercased: deterministic, and SQL identifiers are
// case-insensitive anyway (literal VALUES lose case — documented trade-off).
export function parseSqlCall(sql) {
  const s = sql.trim().toLowerCase();
  const verb = s.split(/\s+/)[0];
  const known = SQL_VERBS[verb];
  if (!known) return null;
  let table = null;
  let m;
  if (verb === 'insert') m = s.match(/insert\s+into\s+"?([\w.]+)"?/);
  else if (verb === 'update') m = s.match(/update\s+"?([\w.]+)"?/);
  else if (verb === 'delete') m = s.match(/delete\s+from\s+"?([\w.]+)"?/);
  else m = s.match(/\bfrom\s+"?([\w.]+)"?/);
  if (m) table = m[1].includes('.') ? m[1].split('.').pop() : m[1];

  const details = {};
  if (verb === 'update') {
    const setM = s.match(/\bset\s+([\s\S]*?)(?:\s+where\s|$)/);
    if (setM) {
      const sets = literalPairsOf(setM[1]);
      if (Object.keys(sets).length) details.sets = sets;
    }
  }
  if (verb === 'update' || verb === 'delete' || verb === 'select') {
    const whereM = s.match(/\bwhere\s+([\s\S]*)$/);
    if (whereM) {
      const where = literalPairsOf(whereM[1]);
      if (Object.keys(where).length) details.where = where;
    }
  }
  if (verb === 'insert') {
    const im = s.match(/\(([^)]*)\)\s*values\s*\(([^)]*)\)/);
    if (im) {
      const cols = im[1].split(',').map((c) => c.trim().replace(/"/g, ''));
      const vals = im[2].split(',').map((v) => v.trim());
      const inserts = {};
      cols.forEach((c, i) => {
        const q = vals[i]?.match(/^'([^']*)'$/);
        if (q) inserts[c] = q[1];
      });
      if (Object.keys(inserts).length) details.inserts = inserts;
    }
  }
  return { ...known, table, ...details };
}

// "status = 'paid', total = 3" → { status: 'paid' } — string literals only,
// bounded; placeholders and expressions are invisible on purpose
function literalPairsOf(clause) {
  const pairs = {};
  for (const m of clause.matchAll(/([\w"]+)\s*=\s*'([^']*)'/g)) {
    if (Object.keys(pairs).length >= 8) break;
    pairs[m[1].replace(/"/g, '')] = m[2];
  }
  return pairs;
}

// middleware classifier: name smell OR observed 401/403 denial → guard. `assertedGuard`
// is an extractor's explicit "this chain step gates by name, unverified" flag (ADR-063,
// the principal-injection param decorators `@GetUser`/`@Principal` whose bare names carry
// no GUARD_NAME token) — honored here so a marked step reads as an ASSERTED guard without
// widening GUARD_NAME globally (which would misclassify a plain `getUser` middleware).
export function isGuardLike(name, scan) {
  return (
    GUARD_NAME.test(name ?? '') ||
    Boolean(scan?.guardSignals?.deniesWithStatus) ||
    Boolean(scan?.assertedGuard)
  );
}
