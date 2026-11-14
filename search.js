// length for context in excerpts
const CONTEXT_LENGTH = 50

const normalizeWhitespace = str => str.replace(/\s+/g, ' ')

const makeExcerpt = (strs, { startIndex, startOffset, endIndex, endOffset }) => {
    const start = strs[startIndex]
    const end = strs[endIndex]
    const match = startIndex === endIndex
        ? start.slice(startOffset, endOffset)
        : start.slice(startOffset)
            + strs.slice(startIndex + 1, endIndex).join('')
            + end.slice(0, endOffset)
    const trimmedStart = normalizeWhitespace(start.slice(0, startOffset)).trimStart()
    const trimmedEnd = normalizeWhitespace(end.slice(endOffset)).trimEnd()
    const ellipsisPre = trimmedStart.length < CONTEXT_LENGTH ? '' : '…'
    const ellipsisPost = trimmedEnd.length < CONTEXT_LENGTH ? '' : '…'
    const pre = `${ellipsisPre}${trimmedStart.slice(-CONTEXT_LENGTH)}`
    const post = `${trimmedEnd.slice(0, CONTEXT_LENGTH)}${ellipsisPost}`
    return { pre, match, post }
}

// characters that are not punctuation or white space
const ipRegExp = /[^\p{P}\p{Z}\t\n\v\f\r\u0085]/u

// the strings are searched as a single text, so that graphemes and words can span
// several of them (e.g. <i>charac</i>teristically); start() and end() give back
// the positions in the strings of the start and of the end of a match
const locateInStrings = strs => {
    const starts = []
    let sum = 0
    for (const str of strs) {
        starts.push(sum)
        sum += str.length
    }
    // the index of the string with the character at offset
    const indexAt = offset => {
        let lo = 0
        let hi = starts.length - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (starts[mid] <= offset) lo = mid
            else hi = mid - 1
        }
        return lo
    }
    return {
        text: strs.join(''),
        starts,
        start: offset => {
            const i = indexAt(offset)
            return [i, offset - starts[i]]
        },
        end: offset => {
            const i = indexAt(offset - 1)
            return [i, offset - starts[i]]
        },
    }
}

// used only without Intl.Segmenter: the text and the query are normalized one character
// at a time (with its combining marks) according to the sensitivity, approximating
// the collator, and each character of the normalized text keeps where it comes from
const simpleSearch = function* (strs, query, options = {}) {
    const { locales = 'en', sensitivity = 'base', ignorePunctuation } = options
    let locale = 'en'
    try {
        locale = new Intl.Collator(locales).resolvedOptions().locale
    } catch (e) {
        console.warn(e)
    }
    const ignoreCase = sensitivity === 'base' || sensitivity === 'accent'
    const ignoreMarks = sensitivity === 'base' || sensitivity === 'case'
    const normalize = str => {
        str = str.replace(/\p{Format}/gu, '')
        if (ignorePunctuation && !ipRegExp.test(str)) return ''
        if (/\s/u.test(str)) return ' '
        // only with sensitivity 'variant' the compatibility variants
        // (ligatures, full width forms, superscripts...) are different
        str = str.normalize(sensitivity === 'variant' ? 'NFC' : 'NFKD')
        if (ignoreMarks) str = str.replace(/(?=\p{Diacritic})\p{M}/gu, '')
        if (ignoreCase) str = str.toLocaleUpperCase(locale).toLocaleLowerCase(locale)
        return str.normalize('NFC')
    }
    const characters = /\P{M}\p{M}*|\p{M}+/gu
    const fold = str => {
        let out = ''
        const from = [], to = [], first = [], last = []
        for (const { 0: char, index } of str.matchAll(characters)) {
            const norm = normalize(char)
            if (!norm || norm === ' ' && out.endsWith(' ')) continue
            // a match can start or end between the characters that a character becomes
            // (e.g. 'f' and 'i' for 'ﬁ'), but not between a letter and its marks
            for (const { 0: c } of norm.matchAll(characters)) for (let i = 0; i < c.length; i++) {
                from.push(index)
                to.push(index + char.length)
                first.push(i === 0)
                last.push(i === c.length - 1)
            }
            out += norm
        }
        return { out, from, to, first, last }
    }
    const needle = fold(query).out
    if (!needle) return
    const loc = locateInStrings(strs)
    const { out: haystack, from, to, first, last } = fold(loc.text)
    let previous = null
    for (let index = haystack.indexOf(needle); index > -1; index = haystack.indexOf(needle, index + 1)) {
        const end = index + needle.length - 1
        if (!first[index] || !last[end]) continue
        // a match covers the whole characters it starts and ends in, so
        // several can be the same (e.g. 's' in 'ß'): only the first one is kept
        if (previous?.start === from[index] && previous.end === to[end]) continue
        previous = { start: from[index], end: to[end] }
        const [startIndex, startOffset] = loc.start(from[index])
        const [endIndex, endOffset] = loc.end(to[end])
        const range = { startIndex, startOffset, endIndex, endOffset }
        yield { range, excerpt: makeExcerpt(strs, range) }
    }
}

const segmenterSearch = function* (strs, query, options = {}) {
    const { locales = 'en', granularity = 'word', sensitivity = 'base' } = options
    let { ignorePunctuation } = options
    let collator
    try {
        collator = new Intl.Collator(locales, { usage: 'search', sensitivity, ignorePunctuation })
    } catch (e) {
        console.warn(e)
        collator = new Intl.Collator('en', { usage: 'search', sensitivity, ignorePunctuation })
    }
    // in case ignorePunctuation is undefined and a locale defaults to true
    // (as of October 2026 only Thai does it and only for usage 'sort')
    ignorePunctuation = collator.resolvedOptions().ignorePunctuation

    // in case an invalid locale has been passed to the collator
    const locale = collator.resolvedOptions().locale
    const graphemes = new Intl.Segmenter(locale, { granularity: 'grapheme' })
    const words = granularity === 'word' ? new Intl.Segmenter(locale, { granularity: 'word' }) : null

    // the query is compared with as many graphemes of the text, so a grapheme that the
    // collator considers equal to several graphemes (e.g. 'ß' and 'ss', 'ﬁ' and 'fi',
    // '㎏' and 'kg') would never match them: it is split into them, each part keeping
    // the offset and length of the original
    const splits = new Map()
    const split = segment => {
        let parts = splits.get(segment)
        if (parts !== undefined) return parts
        parts = null
        const upper = segment.toLocaleUpperCase(locale)
        for (const candidate of [
            segment.normalize('NFKC'),
            upper,
            upper.toLocaleLowerCase(locale),
            segment.toLocaleLowerCase(locale).toLocaleUpperCase(locale),
        ]) {
            if (candidate === segment) continue
            const p = Array.from(graphemes.segment(candidate), x => x.segment)
            if (p.length > 1 && collator.compare(segment, candidate) === 0) {
                parts = p
                break
            }
        }
        splits.set(segment, parts)
        return parts
    }

    // the units compared with the query: graphemes (or their parts), without formatting
    // characters (e.g. soft hyphens), other characters that the collator ignores (e.g. the
    // Arabic tatweel, except with sensitivity 'variant') and, if ignorePunctuation, without
    // punctuation and white space, otherwise with each run of white space as a single ' ';
    // each different segment of a unit has an id (its index in segments), and kind() tells,
    // once for each different grapheme, if it is skipped (null), white space (' '),
    // or the ids of its parts
    const segments = []
    const segmentIds = new Map()
    const idOf = segment => {
        let id = segmentIds.get(segment)
        if (id === undefined) {
            id = segments.push(segment) - 1
            segmentIds.set(segment, id)
        }
        return id
    }
    const spaceId = idOf(' ')
    const kinds = new Map()
    const kind = segment => {
        let k = kinds.get(segment)
        if (k !== undefined) return k
        if (!/[^\p{Format}]/u.test(segment) || ignorePunctuation && !ipRegExp.test(segment)) k = null
        else if (/\s/u.test(segment)) k = ' '
        else if (collator.compare(segment, '') === 0) k = null
        else k = (split(segment) ?? [segment]).map(idOf)
        kinds.set(segment, k)
        return k
    }

    // the flags of a unit
    const FIRST = 1  // the first part of its character
    const LAST = 2  // the last part of its character
    // with whole words: in another word than the previous unit, and not right after it
    const SEPARATED = 4
    // a typed array of the given length with the elements of array
    const resize = (array, length) => {
        const copy = new array.constructor(length)
        copy.set(array)
        return copy
    }
    // the units of a string, in typed arrays rather than as objects, which would take several
    // times more memory (a text can have hundreds of thousands of units): for the unit i,
    // its offsets in the string (from starts[i] to ends[i]), the id of its segment and its
    // flags; the segments of the units are joined, so that the segments of any sequence of
    // units are a slice of the joined string (from offsets[i] to offsets[j]); with whole
    // words, isEdge has 1 at the offsets where words start and at the end of the string
    const units = str => {
        let size = str.length + 16
        let starts = new Int32Array(size)
        let ends = new Int32Array(size)
        let ids = new Int32Array(size)
        let flags = new Uint8Array(size)
        let count = 0
        let previousWord = -1
        const add = (start, end, word, id, flag) => {
            // a character can have more parts than code units (e.g. 'ﬃ')
            if (count === size) {
                size *= 2
                starts = resize(starts, size)
                ends = resize(ends, size)
                ids = resize(ids, size)
                flags = resize(flags, size)
            }
            if (count && word !== previousWord && start > ends[count - 1]) flag |= SEPARATED
            starts[count] = start
            ends[count] = end
            ids[count] = id
            flags[count] = flag
            previousWord = word
            count++
        }
        // with whole words, the index of the word of each unit tells if it's separated
        const wordStarts = words ? Array.from(words.segment(str), x => x.index) : []
        const isEdge = new Uint8Array(words ? str.length + 1 : 0)
        if (words) {
            for (const offset of wordStarts) isEdge[offset] = 1
            isEdge[str.length] = 1
        }
        let word = 0
        let space = null
        for (const { index, segment } of graphemes.segment(str)) {
            const k = kind(segment)
            if (k === null) continue
            while (word + 1 < wordStarts.length && wordStarts[word + 1] <= index) word++
            const end = index + segment.length
            // a run of white space is a single unit, added when the run ends
            if (k === ' ') {
                if (space) space.end = end
                else space = { start: index, end, word }
                continue
            }
            if (space) add(space.start, space.end, space.word, spaceId, FIRST | LAST)
            space = null
            for (let i = 0; i < k.length; i++)
                add(index, end, word, k[i], (i === 0 ? FIRST : 0) | (i === k.length - 1 ? LAST : 0))
        }
        if (space) add(space.start, space.end, space.word, spaceId, FIRST | LAST)
        const offsets = new Int32Array(count + 1)
        const unitSegments = new Array(count)
        for (let i = 0; i < count; i++) {
            unitSegments[i] = segments[ids[i]]
            offsets[i + 1] = offsets[i] + unitSegments[i].length
        }
        return { count, starts, ends, ids, flags, offsets, joined: unitSegments.join(''), isEdge }
    }

    const queryUnits = units(query)
    if (!queryUnits.count) return
    const normalizedQuery = queryUnits.joined

    // when ignoring punctuation, the match is extended to the punctuation marks that the
    // query has before its first and after its last searched character, as long as the
    // text has the same marks there (white space and formatting characters aside)
    const isSkipped = s => !/\S/u.test(s) || !/[^\p{Format}]/u.test(s)
    const edgeMarks = segs => {
        const marks = []
        for (const s of segs) {
            if (isSkipped(s)) continue
            if (ipRegExp.test(s)) break
            marks.push(s)
        }
        return marks
    }
    const queryGraphemes = ignorePunctuation ? Array.from(graphemes.segment(query), x => x.segment) : []
    // both in the order in which they are compared, going away from the match
    const leadingMarks = edgeMarks(queryGraphemes).reverse()
    const trailingMarks = edgeMarks(queryGraphemes.toReversed()).reverse()
    const extendStart = (i, offset) => {
        let start = [i, offset]
        let k = 0
        for (; i >= 0; i--, offset = strs[i]?.length) {
            const segs = graphemes.segment(strs[i])
            while (offset > 0) {
                const { index, segment } = segs.containing(offset - 1)
                offset = index
                if (isSkipped(segment)) continue
                if (segment !== leadingMarks[k]) return start
                start = [i, index]
                if (++k === leadingMarks.length) return start
            }
        }
        return start
    }
    const extendEnd = (i, offset) => {
        let end = [i, offset]
        let k = 0
        for (; i < strs.length; i++, offset = 0) {
            const segs = graphemes.segment(strs[i])
            while (offset < strs[i].length) {
                const { index, segment } = segs.containing(offset)
                offset = index + segment.length
                if (isSkipped(segment)) continue
                if (segment !== trailingMarks[k]) return end
                end = [i, offset]
                if (++k === trailingMarks.length) return end
            }
        }
        return end
    }

    const loc = locateInStrings(strs)
    const { count, starts, ends, ids, flags, offsets, joined, isEdge } = units(loc.text)

    // with whole words, a match starts and ends at the edges of words; the edges of the
    // strings count too, as they can be the edges of blocks, e.g. <p>Chapter 1</p><p>The</p>
    if (words) for (const offset of loc.starts) isEdge[offset] = 1
    // the words in the match must be separated (by something skipped) where those of the
    // query are: e.g. ignoring punctuation and white space, 'ab' isn't a whole word
    // in 'a, b', while 'dont' is one in "don't"
    const length = queryUnits.count
    const sameSeparations = i => {
        for (let k = 1; k < length; k++)
            if ((flags[i + k] & SEPARATED) !== (queryUnits.flags[k] & SEPARATED)) return false
        return true
    }
    // a quick check before comparing a whole sequence: its first unit must be equal to the
    // first unit of the query (computed once for each different segment)
    const firstSegment = segments[queryUnits.ids[0]]
    const startsLikeQuery = segments.map(segment => collator.compare(segment, firstSegment) === 0)

    let previousStart = -1
    let previousEnd = -1
    for (let i = 0; i + length <= count; i++) {
        const last = i + length - 1
        if (!startsLikeQuery[ids[i]]) continue
        // a part of a character is not a whole word
        if (words && !((flags[i] & FIRST) && (flags[last] & LAST) && isEdge[starts[i]] && isEdge[ends[last]])) continue
        // otherwise a match can start or end inside a character, and it covers the whole
        // character (e.g. 'ine' in 'ﬁne', 'stras' in 'straße'), so several sequences can
        // give the same match (e.g. 's' in 'ß'): only the first one is kept
        if (starts[i] === previousStart && ends[last] === previousEnd) continue
        if (collator.compare(normalizedQuery, joined.slice(offsets[i], offsets[i + length])) !== 0) continue
        if (words && !sameSeparations(i)) continue
        previousStart = starts[i]
        previousEnd = ends[last]
        const [startIndex, startOffset] = loc.start(starts[i])
        const [endIndex, endOffset] = loc.end(ends[last])
        const range = { startIndex, startOffset, endIndex, endOffset }
        if (leadingMarks.length) [range.startIndex, range.startOffset] = extendStart(startIndex, startOffset)
        if (trailingMarks.length) [range.endIndex, range.endOffset] = extendEnd(endIndex, endOffset)
        yield { range, excerpt: makeExcerpt(strs, range) }
    }
}

export const search = (strs, query, options) => {
    if (!Intl?.Segmenter) return simpleSearch(strs, query, options)
    return segmenterSearch(strs, query, options)
}

export const searchMatcher = (textWalker, opts) => {
    return function* (doc, query) {
        const iter = textWalker(doc, function* (strs, makeRange) {
            for (const result of search(strs, query, searchOptions(doc, opts))) {
                const { startIndex, startOffset, endIndex, endOffset } = result.range
                result.range = makeRange(startIndex, startOffset, endIndex, endOffset)
                yield result
            }
        }, opts.acceptNode)
        for (const result of iter) yield result
    }
}

export const searchOptions = (doc, opts) => {
    const { defaultLocale, matchCase, matchDiacritics, matchWholeWords, ignorePunctuation } = opts
    return {
        locales: doc?.body?.lang || doc?.documentElement?.lang || defaultLocale || 'en',
        granularity: matchWholeWords ? 'word' : 'grapheme',
        sensitivity: matchDiacritics && matchCase
            ? 'variant'
            : matchDiacritics && !matchCase
                ? 'accent'
                : !matchDiacritics && matchCase
                    ? 'case'
                    : 'base',
        ignorePunctuation,
    }
}

// hyphens that can split a word at the end of a line
const hyphens = String.raw`\-\u00AD\u058A\u1400\u2010\u2011\u2E17\uFE63\uFF0D`
// a hyphen after a letter, at the end of the line
const wordSplit = new RegExp(String.raw`(\p{L}\p{M}*)[${hyphens}]$`, 'u')
// a hyphen or a dash attached to the previous character, at the end of the line
const attachedDash = new RegExp(String.raw`\S[${hyphens}\u2012-\u2015]$`, 'u')
const startsWithLetter = /^\p{L}/u
// scripts written without spaces between words
// (use a regex alternation instead of a character set: Firefox 157 and Chromium 156
// don't match a character class with code points outside the Basic Multilingual Plane
// right before $, e.g. /[\p{scx=Han}]$/u and '𠀀')
const noSpace = String.raw`\p{scx=Han}|\p{scx=Hiragana}|\p{scx=Katakana}|\p{scx=Thai}|\p{scx=Lao}|\p{scx=Khmer}|\p{scx=Myanmar}`
const endsNoSpace = new RegExp(`(?:${noSpace})$`, 'u')
const startsNoSpace = new RegExp(`^(?:${noSpace})`, 'u')
// joins the text before and after a line (or page) break: returns the text
// before, without a hyphen that splits a word, and the separator to add
export const joinLines = (before, after) => {
    // white space at the edges is part of the text, and the lines are already separated
    if (/\s$/u.test(before) || /^\s/u.test(after)) return [before, '']
    // between letters, a hyphen splits a word
    if (wordSplit.test(before) && startsWithLetter.test(after)) return [before.replace(wordSplit, '$1'), '']
    // otherwise it's part of the text, like a dash with no space before it (10-20, COVID-19, 10–20)
    if (attachedDash.test(before)) return [before, '']
    if (endsNoSpace.test(before) || startsNoSpace.test(after)) return [before, '']
    return [before, ' ']
}

export const crossSectionText = async (index, sections, walker, cache, need, cacheSize) => {
    const own = await cachedWalk(index, sections, walker, cache, cacheSize)
    if (!own.strs.length) return
    const strs = [...own.strs]
    const segs = [{ w: own, from: 0, to: strs.length }]
    // borrow the beginning of the next pages, passing over blank ones (max 3 pages)
    for (let i = index + 1; need > 0 && i < sections.length && i <= index + 3; i++) {
        const w = await cachedWalk(i, sections, walker, cache, cacheSize)
        let k = 0
        while (k < w.strs.length && need > 0) need -= w.strs[k++].trim().length
        // whitespace-only nodes around the page break are blanked in the copy (indices don't change)
        const last = strs.findLastIndex(s => s.trim())
        strs.fill('', last + 1)
        const head = w.strs.slice(0, k)
        const first = head.findIndex(s => s.trim())
        head.fill('', 0, first < 0 ? head.length : first)
        let sep = ' '  // page break
        if (last >= 0 && first >= 0) [strs[last], sep] = joinLines(strs[last], head[first])
        strs.push(sep)
        segs.push({ w, from: strs.length, to: strs.length + k })
        strs.push(...head)
    }
    return { doc: own.doc, strs, segs, split: range => splitMatch(range, segs) }
}

export const searchCrossSections = async function* (query, opts, index, sections, walker, cache) {
    const t = await crossSectionText(index, sections, walker, cache, 2 * query.length + 50, 3)
    if (!t) return
    for (const { range, excerpt } of search(t.strs, query, searchOptions(t.doc, opts))) {
        if (range.startIndex >= t.segs[0].to) break  // start on a later page: that page owns it
        yield { parts: t.split(range), excerpt }
    }
}

const cachedWalk = async (index, sections, walker, cache, cacheSize) => {
    let w = cache.get(index)
    if (!w) {
        w = { index, strs: [] }
        const doc = await sections[index].createDocument?.()
        if (doc) walker(doc, function* (strs, makeRange) {
            Object.assign(w, { doc, strs, makeRange })
        }).next()
        cache.set(index, w)
        if (cache.size > cacheSize) cache.delete(cache.keys().next().value)
    }
    return w
}

const splitMatch = ({ startIndex, startOffset, endIndex, endOffset }, segs) => {
    const parts = []
    for (const { w, from, to } of segs) {
        if (from === to || endIndex < from || startIndex >= to) continue
        const [si, so] = startIndex >= from ? [startIndex - from, startOffset] : [0, 0]
        const [ei, eo] = endIndex < to
            ? [endIndex - from, endOffset]
            : [to - from - 1, w.strs[to - from - 1].length]
        if (parts.length && !w.strs.slice(si, ei + 1).some(s => s.trim())) continue // blank page
        parts.push({ index: w.index, range: w.makeRange(si, so, ei, eo) })
    }
    return parts
}
