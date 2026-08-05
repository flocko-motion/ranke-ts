// package: ranke / query_codec
// type:    io
// job:     a Query to the canonical JSON rql.schema.json fixes, plus the shape checks a query
// must pass before it is sent
// limits:  shape only; which claims a read returns is RankeDB's (ranke-go -> query_default.go)
//
// Mirrors ranke-go's query_codec.go, minus DecodeQuery: nothing browser-side receives
// a query, only sends one. The scan rules come from ranke-go's archive.go instead,
// where a read enforces them — catching them here saves the round trip, which is what
// a client-side validator is for.

import type {
  Comparison,
  Execution,
  Limit,
  Order,
  Output,
  PathStep,
  Query,
  Select,
  Where,
} from './query.ts'

/**
 * QueryErrorCode names the rule a query broke, matching ranke-go's sentinel of the
 * same name so both sides report one verdict under one vocabulary.
 */
export type QueryErrorCode =
  | 'ErrQueryNoScope'
  | 'ErrQueryNoHead'
  | 'ErrQueryScanShape'
  | 'ErrQueryScanClaim'
  | 'ErrQueryWhereForm'
  | 'ErrQueryComparisonForm'
  | 'ErrQueryHops'
  | 'ErrQueryEnum'
  | 'ErrQueryOverflow'

/** RankeQueryError reports a query that would be refused. */
export class RankeQueryError extends Error {
  override readonly name: string = 'RankeQueryError'
  readonly code: QueryErrorCode
  /** The field the rule applies to, in the wire's dotted form. */
  readonly field: string

  constructor(code: QueryErrorCode, field: string, detail: string) {
    super(`${field}: ${detail}`)
    this.code = code
    this.field = field
  }
}

const DIRS = ['provenance', 'uses', 'connections'] as const
const SHAPES = ['single', 'path'] as const
const DETAILS = ['id', 'graph', 'claims'] as const
const FORMS = ['original', 'materialized'] as const
// Three values the schema excludes because only a Go caller may set them: the native
// encoding asks for Go objects, and report's error and warn are Go-side thresholds.
const ENCODINGS = ['json', 'cbor'] as const
const REPORTS = ['info', 'debug', 'trace'] as const
const COLLATIONS = ['numeric', 'lexical'] as const
const DIRECTIONS = ['asc', 'desc'] as const
const OVERFLOWS = ['cutoff', 'omit', 'reference'] as const

const OPERATORS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'in', 'glob'] as const

/**
 * ValidateQuery holds a query to the schema's rules plus the three it cannot state:
 * a step's min against its max (R-QHOPS), and what a scan may ask for.
 *
 * The types already refuse a bad enum at compile time, so this earns its keep on a
 * query assembled at run time — from a form, a URL, or stored state.
 */
export function ValidateQuery(q: Query): void {
  validateSelect(q)
  if (q.where !== undefined) validateWhere(q.where, 'where')
  if (q.output !== undefined) validateOutput(q.output)
  if (q.order !== undefined) validateOrder(q.order)
  if (q.limit !== undefined) validateLimit(q.limit)
  if (q.execution !== undefined) validateExecution(q.execution)
}

// validateSelect checks the generator, including the two rules ranke-go enforces at
// read time in archive.go: a scan reaches claims by no stated route.
function validateSelect(q: Query): void {
  const sel: Select | undefined = q.select
  if (sel === undefined || sel.branch === undefined || sel.branch === '') {
    throw new RankeQueryError('ErrQueryNoScope', 'select.branch', 'a scope is mandatory')
  }
  if (sel.branch === '$universe' && sel.head === undefined) {
    throw new RankeQueryError(
      'ErrQueryNoHead',
      'select.head',
      'required under $universe, which confines nothing and so offers no head to fall back on',
    )
  }
  // ranke-go parses these while decoding, so a malformed id is refused there; the
  // schema's pattern is what a client can check without the payload's framing.
  checkId('select.head', sel.head)
  checkId('select.claim', sel.claim)
  const path = sel.path ?? []
  path.forEach((step, i) => validateStep(step, `select.path[${i}]`))
  if (path.length > 0) return

  // A scan.
  if (q.output?.shape === 'path') {
    throw new RankeQueryError(
      'ErrQueryScanShape',
      'output.shape',
      'a scan reaches claims by no stated route, so the shape must be single',
    )
  }
  if (sel.claim !== undefined) {
    throw new RankeQueryError(
      'ErrQueryScanClaim',
      'select.claim',
      'a scan has no traversal to start',
    )
  }
}

// validateStep checks dir and hops. A max of 0 is unbounded, so only a bounded max
// can sit under min.
function validateStep(step: PathStep, field: string): void {
  oneOf(`${field}.dir`, step.dir, DIRS)
  const min = step.min ?? 1
  if (step.max !== undefined && step.max > 0 && min > step.max) {
    throw new RankeQueryError(
      'ErrQueryHops',
      field,
      `min ${min} is above a bounded max ${step.max}, so the step admits no hop count`,
    )
  }
}

// validateWhere holds every node of the tree to exactly one form. The union expresses
// that in the type; a value from outside the type system still has to be checked.
function validateWhere(w: Where, field: string): void {
  const node = w as Record<string, unknown>
  const forms = ['and', 'or', 'not'].filter((k) => node[k] !== undefined)
  const leaf = node.field !== undefined || node.test !== undefined
  if (forms.length + (leaf ? 1 : 0) !== 1) {
    throw new RankeQueryError(
      'ErrQueryWhereForm',
      field,
      `exactly one of and | or | not | {field, test}, got ${forms.length + (leaf ? 1 : 0)}`,
    )
  }
  if (leaf) {
    if (node.field === undefined || node.test === undefined) {
      throw new RankeQueryError(
        'ErrQueryWhereForm',
        field,
        'a leaf carries both a field and a test',
      )
    }
    validateComparison(node.test as Comparison, `${field}.test`)
    return
  }
  if (Array.isArray(node.and)) {
    node.and.forEach((sub, i) => validateWhere(sub as Where, `${field}.and[${i}]`))
  }
  if (Array.isArray(node.or)) {
    node.or.forEach((sub, i) => validateWhere(sub as Where, `${field}.or[${i}]`))
  }
  if (node.not !== undefined) validateWhere(node.not as Where, `${field}.not`)
}

// validateComparison holds a comparison to one operator. An explicit empty `in` set
// counts, being present.
function validateComparison(c: Comparison, field: string): void {
  const node = c as Record<string, unknown>
  const set = OPERATORS.filter((op) => node[op] !== undefined)
  if (set.length !== 1) {
    throw new RankeQueryError(
      'ErrQueryComparisonForm',
      field,
      `exactly one operator (${OPERATORS.join(' | ')}), got ${set.length}`,
    )
  }
}

function validateOutput(o: Output): void {
  oneOf('output.shape', o.shape, SHAPES)
  oneOf('output.detail', o.detail, DETAILS)
  oneOf('output.form', o.form, FORMS)
  oneOf('output.encoding', o.encoding, ENCODINGS)
  if (o.content === undefined) return
  if (o.content.overflow === undefined) {
    throw new RankeQueryError(
      'ErrQueryOverflow',
      'output.content.overflow',
      `required (${OVERFLOWS.join(' | ')})`,
    )
  }
  oneOf('output.content.overflow', o.content.overflow, OVERFLOWS)
  if (o.content.max === undefined || o.content.max < 0) {
    throw new RankeQueryError(
      'ErrQueryEnum',
      'output.content.max',
      'a byte cap is a non-negative integer',
    )
  }
}

function validateOrder(order: Order): void {
  order.forEach((key, i) => {
    if (key.field === undefined || key.field === '') {
      throw new RankeQueryError('ErrQueryEnum', `order[${i}].field`, 'a sort key names a field')
    }
    oneOf(`order[${i}].compare`, key.compare, COLLATIONS)
    oneOf(`order[${i}].dir`, key.dir, DIRECTIONS)
  })
}

function validateLimit(limit: Limit): void {
  if (limit.results !== undefined && limit.results < 0) {
    throw new RankeQueryError('ErrQueryEnum', 'limit.results', 'a cap is non-negative')
  }
  if (limit.time !== undefined && !DURATION.test(limit.time)) {
    throw new RankeQueryError(
      'ErrQueryEnum',
      'limit.time',
      `a duration is a decimal sequence with unit suffixes (ns, us, ms, s, m, h), or a bare 0 — got ${JSON.stringify(limit.time)}`,
    )
  }
}

function validateExecution(exec: Execution): void {
  oneOf('execution.report', exec.report, REPORTS)
}

// The duration grammar the schema fixes: "5s", "1m30s", or a bare "0" for unbounded.
// Go's ParseDuration also accepts a leading sign, which the schema refuses.
const DURATION = /^(0|([0-9]+(\.[0-9]+)?(ns|us|ms|s|m|h))+)$/

// The multibase framing the schema fixes. Whether the payload's own framing parses is
// parseId's answer, and needs the bytes.
const ID = /^b[a-z2-7]+$/

function checkId(field: string, id: string | undefined): void {
  if (id === undefined) return
  if (!ID.test(id)) {
    throw new RankeQueryError(
      'ErrQueryEnum',
      field,
      `an id is multibase base32, matching ${ID.source} — got ${JSON.stringify(id)}`,
    )
  }
}

function oneOf(field: string, got: string | undefined, allowed: readonly string[]): void {
  if (got === undefined) return
  if (!allowed.includes(got)) {
    throw new RankeQueryError(
      'ErrQueryEnum',
      field,
      `${JSON.stringify(got)} is outside the set the schema fixes (${allowed.join(' | ')})`,
    )
  }
}

/**
 * EncodeQuery renders a query as the canonical JSON, validating first so an invalid
 * query never reaches the wire. An absent field stays absent: what a caller's silence
 * becomes is the server's to decide, and every default is stated in the schema.
 */
export function EncodeQuery(q: Query): string {
  ValidateQuery(q)
  return JSON.stringify(q, (key, value: unknown) => {
    // An operator's presence is the signal, so `in: []` is a comparison against the
    // empty set rather than an empty container. Dropping it would leave a comparison
    // applying no operator at all.
    if ((OPERATORS as readonly string[]).includes(key)) return value
    // Elsewhere an empty array or object says nothing a missing key does not, and a
    // wire read by a machine treats the two alike.
    if (Array.isArray(value) && value.length === 0) return undefined
    if (isEmptyObject(value)) return undefined
    return value
  })
}

function isEmptyObject(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v).length === 0
  )
}
