"use client"

import { useEffect } from "react"

const TOOLTIP_SELECTOR = "[data-tooltip], [title]"
const TOOLTIP_ID = "corridor-app-tooltip"

function asElement(target: EventTarget | null): Element | null {
	if (target instanceof Element) return target
	return target instanceof Node ? target.parentElement : null
}

function prepareTrigger(element: Element): string {
	const title = element.getAttribute("title")?.trim()
	if (title) {
		element.setAttribute("data-tooltip", title)
		element.removeAttribute("title")
		if (!element.hasAttribute("aria-description") || element.getAttribute("data-tooltip-description") === "managed") {
			element.setAttribute("aria-description", title)
			element.setAttribute("data-tooltip-description", "managed")
		}
	}
	return element.getAttribute("data-tooltip")?.trim() ?? ""
}

function migrateTitles(root: ParentNode): void {
	if (root instanceof Element && root.hasAttribute("title")) prepareTrigger(root)
	root.querySelectorAll("[title]").forEach((element) => prepareTrigger(element))
}

export function TooltipLayer() {
	useEffect(() => {
		const tooltip = document.createElement("div")
		tooltip.id = TOOLTIP_ID
		tooltip.className = "app-tooltip"
		tooltip.setAttribute("role", "tooltip")
		tooltip.dataset.visible = "false"
		document.body.appendChild(tooltip)

		let active: Element | null = null
		let timer: number | undefined
		let previousDescribedBy: string | null = null

		const position = () => {
			if (!active?.isConnected || tooltip.dataset.visible !== "true") return
			const anchor = active.getBoundingClientRect()
			const box = tooltip.getBoundingClientRect()
			const halfWidth = box.width / 2
			const centerX = anchor.left + anchor.width / 2
			const left = Math.min(window.innerWidth - halfWidth - 10, Math.max(halfWidth + 10, centerX))
			const above = anchor.top >= box.height + 14

			tooltip.dataset.placement = above ? "top" : "bottom"
			tooltip.style.left = `${left}px`
			tooltip.style.top = `${above ? anchor.top - 8 : anchor.bottom + 8}px`
			tooltip.style.transform = above ? "translate(-50%, -100%)" : "translate(-50%, 0)"
		}

		const hide = () => {
			window.clearTimeout(timer)
			timer = undefined
			if (active && previousDescribedBy !== null) {
				if (previousDescribedBy) active.setAttribute("aria-describedby", previousDescribedBy)
				else active.removeAttribute("aria-describedby")
			}
			active = null
			previousDescribedBy = null
			tooltip.dataset.visible = "false"
		}

		const show = (trigger: Element, delay: number) => {
			const content = prepareTrigger(trigger)
			if (!content) return
			if (active === trigger && (timer !== undefined || tooltip.dataset.visible === "true")) return
			window.clearTimeout(timer)
			if (active !== trigger) hide()
			active = trigger
			timer = window.setTimeout(() => {
				if (!trigger.isConnected) return hide()
				tooltip.textContent = content
				tooltip.dataset.visible = "true"
				previousDescribedBy = trigger.getAttribute("aria-describedby")
				const ids = new Set((previousDescribedBy ?? "").split(/\s+/).filter(Boolean))
				ids.add(TOOLTIP_ID)
				trigger.setAttribute("aria-describedby", [...ids].join(" "))
				position()
			}, delay)
		}

		const onPointerOver = (event: PointerEvent) => {
			if (event.pointerType === "touch") return
			const origin = asElement(event.target)
			const trigger = origin?.closest(TOOLTIP_SELECTOR)
			if (trigger) show(trigger, 420)
		}
		const onPointerOut = (event: PointerEvent) => {
			if (!active) return
			const origin = asElement(event.target)
			const trigger = origin?.closest(TOOLTIP_SELECTOR)
			const next = asElement(event.relatedTarget)
			if (trigger === active && !next?.closest(TOOLTIP_SELECTOR)?.isSameNode(active)) hide()
		}
		const onFocusIn = (event: FocusEvent) => {
			const trigger = asElement(event.target)?.closest(TOOLTIP_SELECTOR)
			if (trigger) show(trigger, 280)
		}
		const onFocusOut = (event: FocusEvent) => {
			if (!active) return
			const origin = asElement(event.target)
			const next = asElement(event.relatedTarget)
			if (origin?.closest(TOOLTIP_SELECTOR) === active && !next?.closest(TOOLTIP_SELECTOR)?.isSameNode(active)) hide()
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") hide()
		}

		migrateTitles(document.body)
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				if (record.type === "attributes" && record.target instanceof Element) prepareTrigger(record.target)
				for (const node of record.addedNodes) {
					if (node instanceof Element) migrateTitles(node)
				}
			}
		})
		observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] })
		document.addEventListener("pointerover", onPointerOver, true)
		document.addEventListener("pointerout", onPointerOut, true)
		document.addEventListener("focusin", onFocusIn, true)
		document.addEventListener("focusout", onFocusOut, true)
		document.addEventListener("keydown", onKeyDown, true)
		window.addEventListener("resize", position)
		window.addEventListener("scroll", position, true)

		return () => {
			hide()
			observer.disconnect()
			document.removeEventListener("pointerover", onPointerOver, true)
			document.removeEventListener("pointerout", onPointerOut, true)
			document.removeEventListener("focusin", onFocusIn, true)
			document.removeEventListener("focusout", onFocusOut, true)
			document.removeEventListener("keydown", onKeyDown, true)
			window.removeEventListener("resize", position)
			window.removeEventListener("scroll", position, true)
			tooltip.remove()
		}
	}, [])

	return null
}
