import mitt, { Emitter } from "mitt"
import { Fragment, ReactNode, useCallback, useEffect, useState } from "react"

export function joinJSX(elements: ReactNode[], separator: ReactNode): ReactNode[] {
  return elements.reduce((acc: ReactNode[], element, index) => {
    if (index === 0) return [element]
    return [...acc, <Fragment key={"sep" + index}>{separator}</Fragment>, element]
  }, [])
}

export function preserveLineBreaks(text: string) {
  return joinJSX(text.split("\n"), <br />)
}

interface PopoverTrigger {
  emitter: Emitter<{ toggle: boolean | undefined }>
  toggle: (open?: boolean) => void
}

export function usePopoverTrigger() {
  const [trigger] = useState<PopoverTrigger>(() => {
    const emitter = mitt<{ toggle: boolean | undefined }>()
    return {
      emitter,
      toggle: (open?: boolean) => emitter.emit("toggle", open),
    }
  })
  return trigger
}

interface PopoverControlOptions {
  delay?: number
  trigger?: PopoverTrigger
}

export function usePopoverControl({ trigger, delay = 300 }: PopoverControlOptions = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)

  const setOpenState = useCallback((open?: boolean) => {
    setIsOpen((prev) => {
      const next = open ?? !prev
      if (next) {
        setShouldRender(true)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setShouldRender(false)
      }, delay)
      return () => {
        clearTimeout(timer)
      }
    }
  }, [isOpen, delay])

  useEffect(() => {
    if (!trigger) return
    const handleToggle = (open?: boolean) => {
      setOpenState(open)
    }
    trigger.emitter.on("toggle", handleToggle)
    return () => {
      trigger.emitter.off("toggle", handleToggle)
    }
  }, [trigger, isOpen, setOpenState])

  return { isOpen, shouldRender, setOpenState }
}

export function PopoverControl({
  children,
  ...options
}: PopoverControlOptions & {
  children: (control: ReturnType<typeof usePopoverControl>) => ReactNode
}) {
  const control = usePopoverControl(options)
  if (!control.shouldRender) return null
  return children(control)
}
