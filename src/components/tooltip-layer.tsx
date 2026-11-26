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
			const edgeThreshold = Math.max(180, box.width / 2 + 20)
			const centerY = anchor.top + anchor.height / 2
			const clampedTop = Math.max(10, Math.min(window.innerHeight - box.height - 10, centerY - box.height / 2))
			const setArrowOffset = (offset: number, size: number) => {
				const safeOffset = Math.max(10, Math.min(size - 10, offset))
				tooltip.style.setProperty("--tooltip-arrow-offset", `${safeOffset}px`)
			}

			if (anchor.right >= window.innerWidth - edgeThreshold && anchor.left >= box.width + 16) {
				tooltip.dataset.placement = "left"
				tooltip.style.left = `${anchor.left - box.width - 9}px`
				tooltip.style.top = `${clampedTop}px`
				tooltip.style.transform = "none"
				setArrowOffset(centerY - clampedTop, box.height)
				return
			}

			if (anchor.left <= edgeThreshold && anchor.right + box.width + 16 <= window.innerWidth) {
				tooltip.dataset.placement = "right"
				tooltip.style.left = `${anchor.right + 9}px`
				tooltip.style.top = `${clampedTop}px`
				tooltip.style.transform = "none"
				setArrowOffset(centerY - clampedTop, box.height)
				return
			}

			const centerX = anchor.left + anchor.width / 2
			const left = Math.max(10, Math.min(window.innerWidth - box.width - 10, centerX - box.width / 2))
			const above = anchor.top >= box.height + 14

			tooltip.dataset.placement = above ? "top" : "bottom"
			tooltip.style.left = `${left}px`
			tooltip.style.top = `${above ? anchor.top - 8 : anchor.bottom + 8}px`
			tooltip.style.transform = above ? "translateY(-100%)" : "none"
			setArrowOffset(centerX - left, box.width)
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
