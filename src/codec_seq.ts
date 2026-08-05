// package: ranke / codec_seq
// type:    io
// job:     reading a result run as it arrives — cbor-seq (RFC 8742) and json-seq (RFC 7464),
// each holding a partial record across a chunk boundary
// limits:  framing plus the per-record decode; what a read returns is the server's
//
// ranke-go has no counterpart: it produces results and RankeDB frames them, while a
// browser is the side that must consume a stream it cannot buffer whole.

import type { Claim } from './claim.ts'
import { RankeDecodeError, decodeClaim, type DecodeOptions } from './codec.ts'
import { decodeClaimJSON } from './codec_json.ts'
import { CborReader } from './internal/cbor.ts'

/** SeqEncoding names the framing a result stream arrives in. */
export type SeqEncoding = 'cbor' | 'json'

/**
 * SeqReader turns chunks into claims. Feed it whatever a stream hands over and it
 * returns the records now complete, holding any partial tail for the next call.
 *
 * A push parser rather than an iterator, so a caller owning the read loop can count
 * bytes as they land; readClaims wraps it for the common case.
 */
export interface SeqReader {
  /** push returns the claims completed by this chunk, in arrival order. */
  push(chunk: Uint8Array): Claim[]
  /**
   * end reports the stream closed. It throws when bytes remain that never completed
   * a record, since a truncated result is not an empty one.
   */
  end(): Claim[]
  /** bytesRead is the total fed in, for progress reporting. */
  readonly bytesRead: number
}

/** newSeqReader builds the reader for a framing. */
export function newSeqReader(encoding: SeqEncoding, opts: DecodeOptions = {}): SeqReader {
  return encoding === 'cbor' ? new CborSeqReader(opts) : new JsonSeqReader()
}

/**
 * readClaims yields each claim as it arrives from a byte stream — the shape a
 * `fetch` response body takes.
 *
 * ```ts
 * const res = await fetch(url)
 * for await (const claim of readClaims(res.body!, 'cbor')) { … }
 * ```
 */
export async function* readClaims(
  stream: ReadableStream<Uint8Array>,
  encoding: SeqEncoding,
  opts: DecodeOptions = {},
): AsyncGenerator<Claim, void, undefined> {
  const reader = newSeqReader(encoding, opts)
  const source = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await source.read()
      if (done) break
      for (const claim of reader.push(value)) yield claim
    }
    for (const claim of reader.end()) yield claim
  } finally {
    source.releaseLock()
  }
}

// Buffer accumulates chunks and drops what has been consumed, so a long stream does
// not retain the bytes already turned into claims.
class Buffer {
  #b = new Uint8Array(0)

  get length(): number {
    return this.#b.length
  }

  view(): Uint8Array {
    return this.#b
  }

  append(chunk: Uint8Array): void {
    if (this.#b.length === 0) {
      this.#b = Uint8Array.from(chunk)
      return
    }
    const next = new Uint8Array(this.#b.length + chunk.length)
    next.set(this.#b)
    next.set(chunk, this.#b.length)
    this.#b = next
  }

  consume(n: number): void {
    this.#b = n >= this.#b.length ? new Uint8Array(0) : this.#b.slice(n)
  }
}

/**
 * CborSeqReader reads a CBOR sequence (RFC 8742): canonical items concatenated with
 * no framing of their own, so the reader asks the decoder whether a complete item is
 * present and waits when it is not.
 */
class CborSeqReader implements SeqReader {
  readonly #buf = new Buffer()
  readonly #opts: DecodeOptions
  #read = 0

  constructor(opts: DecodeOptions) {
    this.#opts = opts
  }

  get bytesRead(): number {
    return this.#read
  }

  push(chunk: Uint8Array): Claim[] {
    this.#read += chunk.length
    this.#buf.append(chunk)
    const out: Claim[] = []
    const r = new CborReader(this.#buf.view())
    let consumed = 0
    for (;;) {
      const raw = r.tryScanValue()
      if (raw === null) break
      out.push(decodeClaim(raw, '', this.#opts))
      consumed = r.position
    }
    this.#buf.consume(consumed)
    return out
  }

  end(): Claim[] {
    if (this.#buf.length > 0) {
      throw new RankeDecodeError(`the stream ended mid-record, ${this.#buf.length} byte(s) unread`)
    }
    return []
  }
}

const RS = 0x1e // the record separator RFC 7464 leads each record with
const LF = 0x0a

/**
 * JsonSeqReader reads a JSON text sequence (RFC 7464): each record is preceded by
 * RS and followed by LF, which makes a record boundary findable without parsing.
 */
class JsonSeqReader implements SeqReader {
  readonly #buf = new Buffer()
  #read = 0
  #started = false

  get bytesRead(): number {
    return this.#read
  }

  push(chunk: Uint8Array): Claim[] {
    this.#read += chunk.length
    this.#buf.append(chunk)
    const out: Claim[] = []
    let consumed = 0
    const b = this.#buf.view()

    // A record runs from one RS to the next; the last one in the buffer stays until
    // a following RS, or end(), proves it complete.
    let i = 0
    if (!this.#started) {
      while (i < b.length && b[i] !== RS) i++
      if (i > 0) consumed = i
      if (i < b.length) this.#started = true
    }
    while (this.#started) {
      const next = b.indexOf(RS, i + 1)
      if (next < 0) break
      const rec = b.subarray(i + 1, next)
      const claim = parseJsonRecord(rec)
      if (claim !== null) out.push(claim)
      i = next
      consumed = i
    }
    this.#buf.consume(consumed)
    return out
  }

  end(): Claim[] {
    const b = this.#buf.view()
    if (b.length === 0) return []
    const start = b[0] === RS ? 1 : 0
    const claim = parseJsonRecord(b.subarray(start))
    this.#buf.consume(b.length)
    return claim === null ? [] : [claim]
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

// parseJsonRecord decodes one RFC 7464 record, ignoring the trailing LF and any
// whitespace-only record a producer emitted.
function parseJsonRecord(raw: Uint8Array): Claim | null {
  let end = raw.length
  while (end > 0 && (raw[end - 1] === LF || raw[end - 1] === 0x0d)) end--
  if (end === 0) return null
  const text = utf8.decode(raw.subarray(0, end)).trim()
  if (text === '') return null
  return decodeClaimJSON(JSON.parse(text))
}
