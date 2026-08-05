// package: ranke / filter
// type:    logic
// job:     matching a "class/sub" type against the glob lists a query states
// limits:  matches types; it selects nothing and walks nothing

/**
 * splitType splits a "class/sub" type into its parts. It throws on a value with no
 * separator, an empty class, or an empty subtype, so a caller never has to guess
 * which half a malformed type lost.
 */
export function splitType(t: string): { typeClass: string; typeSub: string } {
  const slash = t.indexOf('/')
  if (slash <= 0 || slash === t.length - 1) {
    throw new RankeTypeError(`expected "class/sub", got ${JSON.stringify(t)}`)
  }
  return { typeClass: t.slice(0, slash), typeSub: t.slice(slash + 1) }
}

/** RankeTypeError reports a type that is not "class/sub". */
export class RankeTypeError extends Error {
  override readonly name: string = 'RankeTypeError'
}

/**
 * matchTypeList reports whether typ satisfies a list of globs over "class/sub",
 * where a leading "-" excludes. An empty list admits everything; only negatives
 * means "match unless excluded"; any positive requires one of them to match.
 *
 * Mirrors ranke-go's matchTypeList (query_walk.go), so the same list selects the
 * same types on either side of the wire.
 */
export function matchTypeList(patterns: readonly string[], typ: string): boolean {
  if (patterns.length === 0) return true
  let hasPositive = false
  let matchedPositive = false
  for (const p of patterns) {
    const neg = p.startsWith('-')
    const pat = neg ? p.slice(1) : p
    const ok = matchGlob(pat, typ)
    if (neg) {
      if (ok) return false
      continue
    }
    hasPositive = true
    if (ok) matchedPositive = true
  }
  return hasPositive ? matchedPositive : true
}

/**
 * matchGlob is Go's `path.Match`, which ranke-go matches type globs with: `*`
 * matches any run of characters other than "/", `?` matches one such character,
 * `[...]` a character class with a leading "^" negating it, and "\\" escapes the
 * next character. A `*` never crossing "/" is what makes `derivation/*` a class
 * selector rather than a wildcard for everything.
 *
 * Ported from Go's scanChunk/matchChunk so the two agree on the awkward cases: a
 * class may contain "/" though a star may not cross one, and "]" first in a class
 * is a literal.
 */
export function matchGlob(pattern: string, name: string): boolean {
  let p = pattern
  let n = name
  while (p.length > 0) {
    const { star, chunk, rest } = scanChunk(p)
    if (star && chunk === '') {
      // A trailing star matches the remainder, so long as no separator is left.
      return !n.includes(SEP)
    }
    const m = matchChunk(chunk, n)
    if (m !== null && (m.rest.length === 0 || rest.length > 0)) {
      n = m.rest
      p = rest
      continue
    }
    if (star) {
      // A star may swallow any number of non-separator characters, so advance one
      // at a time and retry the chunk from there.
      let advanced = false
      for (let i = 0; i < n.length && n[i] !== SEP; i++) {
        const t = matchChunk(chunk, n.slice(i + 1))
        if (t !== null && (t.rest.length === 0 || rest.length > 0)) {
          n = t.rest
          p = rest
          advanced = true
          break
        }
      }
      if (advanced) continue
    }
    return false
  }
  return n.length === 0
}

const SEP = '/'

// scanChunk splits off the leading stars and the run of non-star pattern that
// follows, which is the unit matchChunk consumes.
function scanChunk(p: string): { star: boolean; chunk: string; rest: string } {
  let star = false
  while (p.length > 0 && p[0] === '*') {
    p = p.slice(1)
    star = true
  }
  let inRange = false
  let i = 0
  scan: for (; i < p.length; i++) {
    switch (p[i]) {
      case '\\':
        if (i + 1 < p.length) i++
        break
      case '[':
        inRange = true
        break
      case ']':
        inRange = false
        break
      case '*':
        if (!inRange) break scan
        break
      default:
        break
    }
  }
  return { star, chunk: p.slice(0, i), rest: p.slice(i) }
}

// matchChunk consumes chunk from the front of s, returning what is left, or null
// when the chunk does not match there.
//
// Once the match has failed the loop keeps going, checking the pattern is
// well-formed while no longer reading s: a malformed character class is an error
// even when the name ran out before reaching it.
function matchChunk(chunk: string, s: string): { rest: string } | null {
  let failed = false
  let c = chunk
  while (c.length > 0) {
    if (!failed && s.length === 0) failed = true

    if (c[0] === '[') {
      let ch = ''
      if (!failed) {
        ch = s[0]!
        s = s.slice(1)
      }
      c = c.slice(1)
      let negated = false
      if (c.length > 0 && c[0] === '^') {
        negated = true
        c = c.slice(1)
      }
      let match = false
      let nrange = 0
      for (;;) {
        if (c.length > 0 && c[0] === ']' && nrange > 0) {
          c = c.slice(1)
          break
        }
        const lo = getEsc(c)
        c = lo.rest
        let hi = lo
        if (c[0] === '-') {
          hi = getEsc(c.slice(1))
          c = hi.rest
        }
        if (lo.ch <= ch && ch <= hi.ch) match = true
        nrange++
      }
      if (match === negated) failed = true
      continue
    }

    if (c[0] === '?') {
      if (!failed) {
        if (s[0] === SEP) failed = true
        s = s.slice(1)
      }
      c = c.slice(1)
      continue
    }

    // A backslash escapes the next character, which is then compared literally.
    if (c[0] === '\\') {
      c = c.slice(1)
      if (c.length === 0) throw new RankeTypeError('pattern ends in a backslash')
    }
    if (!failed) {
      if (c[0] !== s[0]) failed = true
      s = s.slice(1)
    }
    c = c.slice(1)
  }
  return failed ? null : { rest: s }
}

// getEsc reads one class member, honouring a backslash escape.
function getEsc(c: string): { ch: string; rest: string } {
  if (c.length === 0 || c[0] === '-' || c[0] === ']') {
    throw new RankeTypeError('malformed character class')
  }
  let i = 0
  if (c[0] === '\\') {
    i++
    if (i >= c.length) throw new RankeTypeError('malformed character class')
  }
  const ch = c[i]!
  const rest = c.slice(i + 1)
  if (rest.length === 0) throw new RankeTypeError('malformed character class')
  return { ch, rest }
}
