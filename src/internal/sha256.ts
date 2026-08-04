// package: internal / sha256
// type:    crypto
// job:     synchronous SHA-256 (FIPS 180-4), the one digest the ADT uses
// limits:  computes a bare digest; multihash framing and id forms live in id.ts
//
// Hand-rolled so the library stays dependency-free and synchronous everywhere —
// crypto.subtle would force a Promise and an environment branch. ranke-go takes
// this from the multiformats libraries, so no Go file corresponds.

const K = /* @__PURE__ */ Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
)

/** sha256 returns the 32-byte digest of data. */
export function sha256(data: Uint8Array): Uint8Array {
  const h = Uint32Array.of(
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  )
  const w = new Uint32Array(64)

  // Whole blocks are read from data in place; only the tail is copied, so hashing
  // a large blob costs no second copy of it.
  const whole = data.length - (data.length % 64)
  for (let i = 0; i < whole; i += 64) compress(h, w, data, i)

  // The tail carries the remaining bytes, the 0x80 terminator, and the length in
  // the last 8 bytes — one block when all three fit, else two.
  const rest = data.length - whole
  const tail = new Uint8Array(rest + 9 <= 64 ? 64 : 128)
  tail.set(data.subarray(whole))
  tail[rest] = 0x80

  // A 64-bit big-endian *bit* count. The high word comes from a division: `<<`
  // truncates to 32 bits, so shifting the length would silently drop it.
  const hi = Math.floor(data.length / 0x20000000)
  const lo = (data.length * 8) >>> 0
  const p = tail.length - 8
  tail[p] = (hi >>> 24) & 0xff
  tail[p + 1] = (hi >>> 16) & 0xff
  tail[p + 2] = (hi >>> 8) & 0xff
  tail[p + 3] = hi & 0xff
  tail[p + 4] = (lo >>> 24) & 0xff
  tail[p + 5] = (lo >>> 16) & 0xff
  tail[p + 6] = (lo >>> 8) & 0xff
  tail[p + 7] = lo & 0xff
  for (let i = 0; i < tail.length; i += 64) compress(h, w, tail, i)

  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    const v = h[i]!
    out[i * 4] = (v >>> 24) & 0xff
    out[i * 4 + 1] = (v >>> 16) & 0xff
    out[i * 4 + 2] = (v >>> 8) & 0xff
    out[i * 4 + 3] = v & 0xff
  }
  return out
}

// compress folds one 64-byte block at b[off:] into the state h, using w as the
// message schedule. h and w are reused across blocks to keep allocation flat.
function compress(h: Uint32Array, w: Uint32Array, b: Uint8Array, off: number): void {
  for (let i = 0; i < 16; i++) {
    const j = off + i * 4
    w[i] = ((b[j]! << 24) | (b[j + 1]! << 16) | (b[j + 2]! << 8) | b[j + 3]!) >>> 0
  }
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15]!
    const y = w[i - 2]!
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
  }

  let a = h[0]!
  let b1 = h[1]!
  let c = h[2]!
  let d = h[3]!
  let e = h[4]!
  let f = h[5]!
  let g = h[6]!
  let hh = h[7]!

  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
    const ch = (e & f) ^ (~e & g)
    const t1 = (hh + S1 + ch + K[i]! + w[i]!) | 0
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
    const maj = (a & b1) ^ (a & c) ^ (b1 & c)
    const t2 = (S0 + maj) | 0
    hh = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b1
    b1 = a
    a = (t1 + t2) | 0
  }

  h[0] = (h[0]! + a) | 0
  h[1] = (h[1]! + b1) | 0
  h[2] = (h[2]! + c) | 0
  h[3] = (h[3]! + d) | 0
  h[4] = (h[4]! + e) | 0
  h[5] = (h[5]! + f) | 0
  h[6] = (h[6]! + g) | 0
  h[7] = (h[7]! + hh) | 0
}
