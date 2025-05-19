const createMenuItemRadioGroup = (label, arr, onclick, onvalidate, horizontal) => {
    const container = document.createElement('fieldset')
    const header = document.createElement('legend')
    header.innerText = label
    const group = document.createElement('ul')
    group.setAttribute('role', 'presentation')
    if (horizontal) {
        group.classList.add('simebv-horizontal')
    }
    const map = new Map()
    let currentValue
    const current = () => currentValue
    const select = value => {
        if (container.getAttribute('aria-disabled') === 'true') return
        onclick(value)
        currentValue = value
        const item = map.get(value)
        for (const child of group.children)
            child.setAttribute('aria-checked', child === item ? 'true' : 'false')
    }
    const enable = (activate) => {
        activate === false
            ? container.setAttribute('aria-disabled', 'true')
            : container.removeAttribute('aria-disabled')
    }
    const visible = (isVisible) => {
        isVisible === false
            ? container.style.display = 'none'
            : container.style.display = null
    }
    const acceptedValues = []
    const validate = onvalidate ?? ((value) => acceptedValues.includes(value))
    for (const [label, value] of arr) {
        const item = document.createElement('li')
        item.setAttribute('role', 'menuitemradio')
        item.innerText = label
        let v
        if (typeof value === 'string' || typeof value === 'number') {
            v = value
        }
        else {
            const { val, type, attrs, onchange, prefix = '', suffix = '' } = value
            const containerInput = document.createElement('span')
            if (attrs.id)
                containerInput.id = attrs.id + '-container'
            const input = document.createElement('input')
            input.type = type
            for (const [attr, val] of Object.entries(attrs)) {
                input.setAttribute(attr, val)
            }
            input.onchange = onchange
            containerInput.append(prefix, input, suffix)
            item.append(containerInput)
            v = val
        }
        item.onclick = () => select(v)
        item.onkeydown = (e) => { if (e.key === ' ') select(v) }
        map.set(v, item)
        acceptedValues.push(v)
        group.append(item)
    }
    container.append(header, group)
    return { element: container, select, enable, validate, current, visible }
}

const createActionMenuItem = (label, shortcut, onclick, container, attrs, ...args) => {

    const p = document.createElement('p')
    p.innerText = label
    p.setAttribute('role', 'menuitem')
    if (attrs) {
        for (const [attr, value] of attrs) {
            p.setAttribute(attr, value)
        }
    }
    p.onclick = () => onclick(...args)

    if (!container) {
        container = document.createElement('fieldset')
        container.append(p)
    }

    if (shortcut) {
        const s = document.createElement('span')
        s.innerText = shortcut
        s.classList.add('simebv-menu-shortcut')
        p.append(s)
    }

    const enable = (activate) => {
        activate === false
            ? container.setAttribute('aria-disabled', 'true')
            : container.removeAttribute('aria-disabled')
    }

    const visible = (isVisible) => {
        isVisible === false
            ? container.style.display = 'none'
            : container.style.display = null
    }

    return { element: container, enable, visible }
}

export const createActionMenuGroup = (label, arr) => {
    const container = document.createElement('fieldset')
    const menuGroup = { element: container, items: {} }
    const header = document.createElement('legend')
    header.innerText = label
    const group = document.createElement('ul')
    group.setAttribute('role', 'presentation')
    container.append(header, group)
    for (const item of arr) {
        const listItem = document.createElement('li')
        listItem.setAttribute('role', 'menuitem')
        listItem.innerText = item.label
        if (item.classList) {
            listItem.classList.add(...item.classList)
        }
        listItem.onclick = () => item.onclick()
        const select = () => listItem.click()
        const enable = (active) => {
            active === false
                ? listItem.setAttribute('aria-disabled', 'true')
                : listItem.removeAttribute('aria-disabled')
        }
        menuGroup.items[item.name] = {
            element: listItem, select, enable
        }
        group.append(listItem)
    }

    menuGroup.enable = (activate) => {
        activate === false
            ? container.setAttribute('aria-disabled', 'true')
            : container.removeAttribute('aria-disabled')
    }

    menuGroup.visible = (isVisible) => {
        isVisible === false
            ? container.style.display = 'none'
            : container.style.display = null
    }

    return menuGroup
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

    // window.addEventListener('blur', element.hide)
    element.addEventListener('click', (e) => e.stopPropagation())

    for (const { name, label, type, items, onclick, onvalidate, horizontal, shortcut, attrs } of arr) {
        let widget
        switch (type) {
            case 'radio':
                widget = createMenuItemRadioGroup(label, items, onclick, onvalidate, horizontal)
                break
            case 'action':
                widget = createActionMenuItem(label, shortcut, hideAnd(onclick), undefined, attrs)
                break
            case 'group':
                widget = createActionMenuGroup(label, items)
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
    const isVisible = item => {
        let node = item
        while (node && node !== element) {
            const style = globalThis.getComputedStyle(node)
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
                return false
            }
            node = node.parentElement
        }
        return true
    }

    const acceptNode = node => (isMenuItem(node) && isVisible(node))
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
