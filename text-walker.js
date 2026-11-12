const walkRange = (range, walker) => {
    const nodes = []
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
        const compare = range.comparePoint(node, 0)
        if (compare === 0) nodes.push(node)
        else if (compare > 0) break
    }
    return nodes
}

const walkDocument = (_, walker) => {
    const nodes = []
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        nodes.push(node)
    return nodes
}

export const pdfArtifactSelector = '.markedContent[data-foliate-artifact]'

export const textWalkerFilters = {
    filter: NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION,
    acceptNode: node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const name = node.tagName.toLowerCase()
            if (['script', 'style'].includes(name) || node.matches(pdfArtifactSelector)) {
                return NodeFilter.FILTER_REJECT
            }
            return NodeFilter.FILTER_SKIP
        }
        return NodeFilter.FILTER_ACCEPT
    }
}

export const textWalker = function* (x, func, filterFunc) {
    const { filter, acceptNode } = textWalkerFilters
    const root = x.commonAncestorContainer ?? x.body ?? x
    const walker = document.createTreeWalker(root, filter, { acceptNode: filterFunc || acceptNode })
    const walk = x.commonAncestorContainer ? walkRange : walkDocument
    const nodes = walk(x, walker)
    const strs = nodes.map(node => node.nodeValue ?? '')
    const makeRange = (startIndex, startOffset, endIndex, endOffset) => {
        const range = document.createRange()
        range.setStart(nodes[startIndex], startOffset)
        range.setEnd(nodes[endIndex], endOffset)
        return range
    }
    for (const match of func(strs, makeRange)) yield match
}
