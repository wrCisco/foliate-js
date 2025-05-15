const createMenuItemRadioGroup = (label, arr, onclick, horizontal) => {
    const container = document.createElement('fieldset')
    const header = document.createElement('legend')
    header.innerText = label
    const group = document.createElement('ul')
    group.setAttribute('role', 'presentation')
    if (horizontal) {
        group.classList.add('simebv-horizontal')
    }
    const map = new Map()
    const select = value => {
        if (container.getAttribute('aria-disabled') === 'true') return
        onclick(value)
        const item = map.get(value)
        for (const child of group.children)
            child.setAttribute('aria-checked', child === item ? 'true' : 'false')
    }
    const enable = (activate) => {
        activate === false
            ? container.setAttribute('aria-disabled', 'true')
            : container.setAttribute('aria-disabled', 'false')
    }
    for (const [label, value] of arr) {
        const item = document.createElement('li')
        item.setAttribute('role', 'menuitemradio')
        item.innerText = label
        item.onclick = () => select(value)
        item.onkeydown = (e) => { if (e.key === ' ') select(value) }
        map.set(value, item)
        group.append(item)
    }
    container.append(header, group)
    return { element: container, select, enable }
}

const createActionMenuItem = (label, shortcut, onclick, ...args) => {
    const container = document.createElement('fieldset')

    const p = document.createElement('p')
    p.innerText = label
    p.setAttribute('role', 'menuitem')
    p.setAttribute('aria-haspopup', 'dialog')
    p.onclick = () => onclick(...args)

    container.append(p)

    const s = document.createElement('span')
    s.innerText = shortcut
    s.classList.add('simebv-menu-shortcut')

    p.append(s)

    return { element: container, }
}

export const createMenu = arr => {
    const groups = {}
    const element = document.createElement('ul')
    element.setAttribute('role', 'menu')

    let currentItem
    let returnFocusTo
    element.show = (returnFocus) => {
        element.classList.add('simebv-show')
        const firstMenuItem = element.querySelector('[role^=menuitem]')
        firstMenuItem.tabIndex = 0
        firstMenuItem.focus()
        currentItem = firstMenuItem
        if (returnFocus) returnFocusTo = returnFocus
    }
    element.hide = () => {
        element.classList.remove('simebv-show')
        if (currentItem) currentItem.tabIndex = -1
        if (returnFocusTo) {
            returnFocusTo.focus()
            returnFocusTo = undefined
        }
        const e = new CustomEvent('closeMenu', { bubbles: true })
        element.dispatchEvent(e)
    }
    const hideAnd = f => (...args) => (element.hide(), f(...args))
    const updateFocus = (cur, next) => {
        cur.tabIndex = -1
        next.tabIndex = 0
        next.focus()
        currentItem = next
    }

    window.addEventListener('blur', element.hide)
    element.addEventListener('click', (e) => e.stopPropagation())

    for (const { name, label, type, items, onclick, horizontal, shortcut } of arr) {
        let widget
        switch (type) {
            case 'radio':
                widget = createMenuItemRadioGroup(label, items, hideAnd(onclick), horizontal)
                break
            case 'action':
                widget = createActionMenuItem(label, shortcut, hideAnd(onclick))
                break
            default:
                null
        }
        if (name) groups[name] = widget
        const item = document.createElement('li')
        item.setAttribute('role', 'presentation')
        item.append(widget.element)
        element.append(item)
    }

    const isMenuItem = item => ['menuitem', 'menuitemradio', 'menuitemcheckbox'].includes(item.getAttribute('role'))
    const isEnabled = item => !(
        item.getAttribute('disabled')
        || item.getAttribute('aria-disabled') === 'true'
        || item.parentElement.getAttribute('disabled')
        || item.parentElement.getAttribute('aria-disabled') === 'true'
    )

    const acceptNode = node => isMenuItem(node)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    const iter = document.createTreeWalker(element, 1, { acceptNode })
    const getIter = current => (iter.currentNode = current, iter)

    const menuItems = Array.from(element.querySelectorAll('[role^=menuitem]') || [])

    for (const item of menuItems) {
        item.addEventListener('keydown', event => {
            let stop = false
            const { currentTarget, key } = event
            switch (key) {
                case ' ':
                case 'Enter':
                    if (isEnabled(currentTarget)) {
                        currentTarget.click()
                        stop = true
                    }
                    break
                case 'ArrowDown': {
                    const next = getIter(currentTarget).nextNode()
                    if (next) {
                        updateFocus(currentTarget, next)
                    }
                    stop = true
                    break
                }
                case 'ArrowUp': {
                    const prev = getIter(currentTarget).previousNode()
                    if (prev) {
                        updateFocus(currentTarget, prev)
                    }
                    stop = true
                    break
                }
                case 'ArrowLeft': {
                    const prev = getIter(currentTarget).previousNode()
                    if (prev && currentTarget.parentElement.classList.contains('simebv-horizontal')
                            && currentTarget.parentElement === currentTarget.previousSibling?.parentElement) {
                        updateFocus(currentTarget, prev)
                    }
                    stop = true
                    break
                }
                case 'ArrowRight': {
                    const next = getIter(currentTarget).nextNode()
                    if (next && currentTarget.parentElement.classList.contains('simebv-horizontal')
                            && currentTarget.parentElement === currentTarget.nextSibling?.parentElement) {
                        updateFocus(currentTarget, next)
                    }
                    stop = true
                    break
                }
                case 'Home':
                    updateFocus(currentTarget, menuItems[0])
                    stop = true
                    break
                case 'End': {
                    updateFocus(currentTarget, menuItems[menuItems.length - 1])
                    stop = true
                    break
                }
            }
            if (stop) {
                event.preventDefault()
                event.stopPropagation()
            }
        })
    }
    return { element, groups }
}
