// package: ranke / content
// type:    data
// job:     where a record's content lives — inline bytes, an external address, or nothing
// limits:  describes content; fetching external bytes is the caller's, and verifying them
// needs the hash this only carries

/**
 * ContentKind states whether and where a record's content lives. ranke-go has this
 * as an int enum on Universe; a string union reads in a debugger and needs no table.
 */
export type ContentKind = 'none' | 'inline' | 'external'

export const ContentNone = 'none'
export const ContentInline = 'inline'
export const ContentExternal = 'external'

/**
 * ContentRef is a node's or edge's content declaration. `inline` and `hash` are
 * mutually exclusive (§Content): the claim id commits to inline bytes directly,
 * while external content is addressed and fetched.
 */
export type ContentRef =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'inline'
      /**
       * The bytes, or null where the record declares content it did not carry — what a
       * read under a content cap delivers (R-QCONTENT), and what a structure-only cache
       * holds. `size` still states the true length, so ask again with a wider cap.
       */
      readonly bytes: Uint8Array | null
      readonly size: number
      /** The media type, "class/sub" — mandatory wherever content is present. */
      readonly encoding: string
    }
  | {
      readonly kind: 'external'
      /** H(content), as a multibase id string. */
      readonly hash: string
      readonly size: number
      readonly encoding: string
    }

/** contentNone is the shared value for a record carrying nothing. */
export const contentNone: ContentRef = Object.freeze({ kind: ContentNone })

/** hasContent reports whether a record declares content at all. */
export function hasContent(c: ContentRef): boolean {
  return c.kind !== ContentNone
}

/** contentSize is the declared byte length, 0 without content. */
export function contentSize(c: ContentRef): number {
  return c.kind === ContentNone ? 0 : c.size
}

/** contentEncoding is the media type, "" without content. */
export function contentEncoding(c: ContentRef): string {
  return c.kind === ContentNone ? '' : c.encoding
}

/**
 * inlineBytes returns the inline bytes, or null when the content is external, absent,
 * or withheld — external content lives in the Universe and is fetched by its hash.
 */
export function inlineBytes(c: ContentRef): Uint8Array | null {
  return c.kind === ContentInline ? c.bytes : null
}

/**
 * contentWithheld reports content the record declares without carrying: a read under a
 * cap (R-QCONTENT) inlines a prefix of a claim's content and leaves the rest out, and a
 * cache may hold structure alone. Distinct from having no content, which `size` 0 says.
 */
export function contentWithheld(c: ContentRef): boolean {
  return c.kind === ContentInline && c.bytes === null
}
