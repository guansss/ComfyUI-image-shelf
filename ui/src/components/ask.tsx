import { uniqueId } from "lodash-es"
import mitt from "mitt"
import { Fragment, memo, useCallback, useEffect, useId, useRef, useState } from "react"
import { IsNever } from "type-fest"

import { useTranslation } from "../i18n/i18n"
import { Button } from "./ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { Input } from "./ui/input"

export interface AskRequest<T> {
  type: "confirm" | "delete" | "custom"
  title: string
  message?: string
  form?: boolean
  content?: React.ReactNode
  render?: IsNever<T> extends true ? never : (props: AskRenderProps<T>) => React.ReactNode
  initialValue?: T
  confirmText?: string
  cancelText?: string
  onCancel?: () => void
  /** Returns false to prevent closing the dialog. */
  onConfirm?: (...args: IsNever<T> extends true ? [] : [value: T]) => boolean | void
}

export type CustomAskOptions<T> = Omit<AskRequest<T>, "type" | "render">

export type AskRenderProps<T> = Omit<AskProcess<T>, "render">

type AskProcessMeta = {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
}
type AskProcess<T> = AskRequest<T> & AskProcessMeta

const DISPOSE_DELAY = 300
const emitter = mitt<AskEvents>()

type AskEvents = {
  add: AskRequest<any>
}

type GetAskReturn<T> = [T] extends [never] ? boolean : T | null

export function ask<T = never>(req: AskRequest<T>): Promise<GetAskReturn<T>> {
  return new Promise<unknown>((resolve) => {
    if (isCustomAsk(req)) {
      const customReq = req as AskRequest<unknown>
      const resolvableReq: typeof customReq = {
        ...customReq,
        onConfirm: (value) => {
          if (customReq.onConfirm?.(value) === false) {
            return false
          }
          resolve(value)
          return true
        },
        onCancel: () => {
          customReq.onCancel?.()
          resolve(null)
        },
      }
      emitter.emit("add", resolvableReq)
    } else {
      const defaultReq = req as AskRequest<never>
      const resolvableReq: typeof defaultReq = {
        ...defaultReq,
        onConfirm: () => {
          if (defaultReq.onConfirm?.() === false) {
            return false
          }
          resolve(true)
          return true
        },
        onCancel: () => {
          defaultReq.onCancel?.()
          resolve(false)
        },
      }
      emitter.emit("add", resolvableReq as AskRequest<any>)
    }
  }) as Promise<GetAskReturn<T>>
}

function isCustomAsk<T extends { type: string }>(req: T): req is Extract<T, { type: "custom" }> {
  return req.type === "custom"
}

export function AskProvider() {
  const [processes, setProcesses] = useState<AskProcess<any>[]>([])
  const disposeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const addProcess = useCallback((req: AskRequest<any>) => {
    if (req.type === "custom" && !req.render) {
      console.warn("Custom ask request is missing a render function.")
    }

    const process: AskProcess<any> = {
      id: uniqueId(),
      open: true,
      onOpenChange: (open: boolean) => {
        setProcesses((prev) => prev.map((p) => (p.id === process.id ? { ...p, open } : p)))
      },
      ...req,
    }
    setProcesses((prev) => [...prev, process])
  }, [])

  useEffect(() => {
    emitter.on("add", addProcess)
    return () => emitter.off("add", addProcess)
  }, [addProcess])

  useEffect(() => {
    const timers = disposeTimers.current

    processes.forEach((process) => {
      if (!process.open && !timers[process.id]) {
        const timer = setTimeout(() => {
          setProcesses((prev) => prev.filter((p) => p.id !== process.id))
          delete timers[process.id]
        }, DISPOSE_DELAY)
        timers[process.id] = timer
      } else if (process.open && timers[process.id]) {
        clearTimeout(timers[process.id])
        delete timers[process.id]
      }
    })
  }, [processes])

  return processes.map(({ render, ...process }) => {
    if (render) {
      return <Fragment key={process.id}>{render(process)}</Fragment>
    }
    return <AskDialog key={process.id} {...(process as AskProcess<never>)} />
  })
}

export const AskDialog = memo(
  ({
    id,
    type,
    open,
    title,
    message,
    form,
    content,
    confirmText,
    cancelText,
    onCancel,
    onConfirm,
    onOpenChange,
  }: AskRenderProps<never>) => {
    const t = useTranslation()
    const uid = useId()

    const handleConfirm = () => {
      const result = onConfirm?.()
      if (result !== false) onOpenChange(false)
    }

    return (
      <Dialog
        key={id}
        open={open}
        onOpenChange={(open) => {
          onOpenChange(open)
          if (!open) {
            onCancel?.()
          }
        }}
      >
        <DialogContent className="w-150">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {message && <DialogDescription>{message}</DialogDescription>}
          </DialogHeader>
          {form ? (
            <form
              id={uid}
              onSubmit={(e) => {
                e.preventDefault()
                handleConfirm()
              }}
            >
              {content}
            </form>
          ) : (
            content
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{cancelText ?? t.common.cancel}</Button>
            </DialogClose>
            {form ? (
              <Button type="submit" form={uid}>
                {confirmText ?? t.common.confirm}
              </Button>
            ) : (
              <Button
                variant={type === "delete" ? "destructive" : undefined}
                onClick={handleConfirm}
              >
                {confirmText ?? t.common.confirm}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  },
)
AskDialog.displayName = "AskDialog"

interface AskInputMeta {
  placeholder?: string
  validate?: (value: string) => boolean
}

export async function askInput(req: CustomAskOptions<string>, meta: AskInputMeta) {
  return await ask({
    type: "custom",
    ...req,
    render: (props) => <AskInputDialog {...props} {...meta} />,
  })
}

export function AskInputDialog({
  initialValue,
  onConfirm,
  placeholder,
  validate,
  ...props
}: AskRenderProps<string> & AskInputMeta) {
  const [value, setValue] = useState(initialValue ?? "")

  return (
    <AskDialog
      {...props}
      content={
        <div className="flex flex-col items-end gap-2">
          <Input
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      }
      onConfirm={() => {
        if (validate && !validate(value)) {
          return false
        }
        onConfirm?.(value)
        return true
      }}
    />
  )
}
