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

const simpleSearch = function* (strs, query, options = {}) {
    const { locales = 'en', sensitivity } = options
    const matchCase = sensitivity === 'variant'
    const haystack = strs.join('')
    const lowerHaystack = matchCase ? haystack : haystack.toLocaleLowerCase(locales)
    const needle = matchCase ? query : query.toLocaleLowerCase(locales)
    const needleLength = needle.length
    let index = -1
    let strIndex = -1
    let sum = 0
    do {
        index = lowerHaystack.indexOf(needle, index + 1)
        if (index > -1) {
            while (sum <= index) sum += strs[++strIndex].length
            const startIndex = strIndex
            const startOffset = index - (sum - strs[strIndex].length)
            const end = index + needleLength
            while (sum < end) sum += strs[++strIndex].length
            const endIndex = strIndex
            const endOffset = end - (sum - strs[strIndex].length)
            const range = { startIndex, startOffset, endIndex, endOffset }
            yield { range, excerpt: makeExcerpt(strs, range) }
        }
    } while (index > -1)
}

const segmenterSearch = function* (strs, query, options = {}) {
    const { locales = 'en', granularity = 'word', sensitivity = 'base' } = options
    let { ignorePunctuation } = options
    let segmenter, collator
    try {
        segmenter = new Intl.Segmenter(locales, { granularity })
        collator = new Intl.Collator(locales, { usage: 'search', sensitivity, ignorePunctuation })
    } catch (e) {
        console.warn(e)
        segmenter = new Intl.Segmenter('en', { granularity })
        collator = new Intl.Collator('en', { usage: 'search', sensitivity, ignorePunctuation })
    }
    // in case ignorePunctuation is undefined and a locale defaults to true
    // (as of October 2026 only Thai does it and only for usage 'sort')
    ignorePunctuation = collator.resolvedOptions().ignorePunctuation

    // in case an invalid locale has been passed to the collator
    const locale = collator.resolvedOptions().locale

    // with granularity === 'grapheme', a grapheme that the collator considers
    // equal to several graphemes (e.g. 'ß' and 'ss') would never match, so it is
    // split into parts, each one keeping the offset and length of the original
    const expand = sensitivity === 'base' && granularity === 'grapheme'
    const segmentText = function* (str) {
        for (const { index, segment } of segmenter.segment(str)) {
            if (expand) {
                const norm = segment.toLocaleLowerCase(locale).toLocaleUpperCase(locale)
                const parts = norm === segment ? []
                    : Array.from(segmenter.segment(norm), x => x.segment)
                if (parts.length > 1 && collator.compare(segment, norm) === 0) {
                    for (const [i, part] of parts.entries()) yield {
                        index, segment: part, length: segment.length,
                        isFirst: i === 0, isLast: i === parts.length - 1,
                    }
                    continue
                }
            }
            yield { index, segment, length: segment.length, isFirst: true, isLast: true }
        }
    }

    const ipRegExp = /[^\p{P}\p{Z}\t\n\v\f\r\u0085]/u
    const querySegments = []
    for (const { segment } of segmentText(query)) {
        if (!/[^\p{Format}]/u.test(segment)) continue
        if (ignorePunctuation && !ipRegExp.test(segment)) continue
        if (/\s/u.test(segment)) {
            if (!/\s/u.test(querySegments[querySegments.length - 1]))
                querySegments.push(' ')
            continue
        }
        querySegments.push(segment)
    }
    const normalizedQuery = querySegments.join('')
    if (!querySegments.length) return

    // when ignoring punctuation, the match is extended to the punctuation marks that the
    // query has before its first and after its last searched character, as long as the
    // text has the same marks there (white space and formatting characters aside)
    const graphemes = new Intl.Segmenter(locale, { granularity: 'grapheme' })
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

    const substrArr = []
    let strIndex = 0
    let segments = segmentText(strs[strIndex])
    main: while (strIndex < strs.length) {
        while (substrArr.length < querySegments.length) {
            const { done, value } = segments.next()
            if (done) {
                // the current string is exhausted
                // move on to the next string
                strIndex++
                if (strIndex < strs.length) {
                    segments = segmentText(strs[strIndex])
                    continue
                } else break main
            }
            const { index, segment } = value
            // ignore formatting characters
            if (!/[^\p{Format}]/u.test(segment)) continue
            // ignore punctuation if requested
            if (ignorePunctuation && !ipRegExp.test(segment)) continue
            // normalize whitespace
            if (/\s/u.test(segment)) {
                if (!/\s/u.test(substrArr[substrArr.length - 1]?.segment))
                    substrArr.push({ strIndex, index, segment: ' ', length: 1, isFirst: true, isLast: true })
                continue
            }
            value.strIndex = strIndex
            substrArr.push(value)
        }
        const substr = substrArr.map(x => x.segment).join('')
        const firstSeg = substrArr[0]
        const lastSeg = substrArr[substrArr.length - 1]
        // when ignoring punctuation, normalizedQuery and substr combine multiple words into one,
        // so, to match whole words only, it is necessary to compare the segments separately
        if (firstSeg.isFirst && lastSeg.isLast && (ignorePunctuation && granularity === 'word'
                ? querySegments.every((seg, i) => collator.compare(seg, substrArr[i].segment) === 0)
                : collator.compare(normalizedQuery, substr) === 0)) {
            const endIndex = strIndex
            const endOffset = lastSeg.index + lastSeg.length
            const startIndex = firstSeg.strIndex
            const startOffset = firstSeg.index
            const range = { startIndex, startOffset, endIndex, endOffset }
            if (leadingMarks.length) [range.startIndex, range.startOffset] = extendStart(startIndex, startOffset)
            if (trailingMarks.length) [range.endIndex, range.endOffset] = extendEnd(endIndex, endOffset)
            yield { range, excerpt: makeExcerpt(strs, range) }
        }
        substrArr.shift()
    }
}

export const search = (strs, query, options) => {
    const { granularity = 'grapheme', sensitivity = 'base', ignorePunctuation = false } = options
    if (!Intl?.Segmenter || granularity === 'grapheme'
    && (sensitivity === 'variant' || sensitivity === 'accent') && !ignorePunctuation)
        return simpleSearch(strs, query, options)
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
        locales: doc.body.lang || doc.documentElement.lang || defaultLocale || 'en',
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