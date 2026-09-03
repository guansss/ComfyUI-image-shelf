import { uniqueId } from "lodash-es"
import mitt from "mitt"
import { memo, useCallback, useEffect, useId, useState } from "react"
import { SetOptional } from "type-fest"

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

interface AskRequestBase {
  type: "confirm" | "delete" | "custom"
  title: string
  message?: string
  form?: boolean
  content?: React.ReactNode
  confirmText?: string
  cancelText?: string
  onCancel?: () => void
}

interface AskRequestConfirm extends AskRequestBase {
  type: "confirm"
  onConfirm?: () => void
}

interface AskRequestDelete extends AskRequestBase {
  type: "delete"
  onConfirm?: () => void
}

type AskRequestDefault = AskRequestConfirm | AskRequestDelete

interface AskRequestCustom<T> extends AskRequestBase {
  type: "custom"
  component: React.ComponentType<AskDialogProps<T>>
  initialValue?: T
  onConfirm?: (value: T) => void
}

type AskRequest = AskRequestDefault | AskRequestCustom<unknown>

type AskProcessMeta = {
  id: string
  open: boolean
}
type AskProcessBase = AskRequestBase & AskProcessMeta
type AskProcessDefault = AskProcessBase & AskRequestDefault
type AskProcessCustom<T> = AskProcessBase & AskRequestCustom<T>
type AskProcess = AskProcessDefault | AskProcessCustom<unknown>

type AskEvents = {
  add: AskRequest
}

const emitter = mitt<AskEvents>()

type GetAskReturn<T> = T extends AskRequestDefault
  ? boolean
  : T extends AskRequestCustom<infer U>
    ? U | null
    : never

function askGeneric<T extends AskRequestBase>(
  req: T extends AskRequestDefault
    ? T
    : T extends AskRequestCustom<infer U>
      ? AskRequestCustom<U>
      : never,
): Promise<GetAskReturn<T>> {
  return new Promise<unknown>((resolve) => {
    if (isCustomAsk(req)) {
      const customReq = req as AskRequestCustom<unknown>
      const resolvableReq: typeof customReq = {
        ...customReq,
        onConfirm: (value) => {
          customReq.onConfirm?.(value)
          resolve(value)
        },
        onCancel: () => {
          customReq.onCancel?.()
          resolve(null)
        },
      }
      emitter.emit("add", resolvableReq)
    } else {
      const defaultReq = req as AskRequestDefault
      const resolvableReq: typeof defaultReq = {
        ...defaultReq,
        onConfirm: () => {
          defaultReq.onConfirm?.()
          resolve(true)
        },
        onCancel: () => {
          defaultReq.onCancel?.()
          resolve(false)
        },
      }
      emitter.emit("add", resolvableReq)
    }
  }) as Promise<GetAskReturn<T>>
}

type OptionalTypeForConfirm<T extends AskRequestDefault> = T extends AskRequestConfirm
  ? SetOptional<T, "type">
  : T

export function ask(req: OptionalTypeForConfirm<AskRequestDefault>): Promise<boolean> {
  if (!req.type) {
    req.type = "confirm"
  }
  return askGeneric(req as AskRequestDefault)
}

export type AskCustomParam<T> = Omit<AskRequestCustom<T>, "type">

export function askCustom<T>(req: AskCustomParam<T>): Promise<T | null> {
  return askGeneric({ ...req, type: "custom" })
}

function isCustomAsk<T extends { type: string }>(req: T): req is Extract<T, { type: "custom" }> {
  return req.type === "custom"
}

export function AskProvider() {
  const [processes, setProcesses] = useState<AskProcess[]>([])

  const addProcess = useCallback((req: AskRequest) => {
    const process: AskProcess = {
      id: uniqueId(),
      open: true,
      ...req,
    }
    if (isCustomAsk(process)) {
      process.component = memo(process.component)
    }
    setProcesses((prev) => [...prev, process])
  }, [])

  useEffect(() => {
    emitter.on("add", addProcess)
    return () => emitter.off("add", addProcess)
  }, [addProcess])

  return processes.map((process) => {
    const onUpdate = (newProcess: AskProcess) => {
      setProcesses((prev) => prev.map((ins) => (ins.id === newProcess.id ? newProcess : ins)))
    }
    const onDispose = () => {
      setProcesses((prev) => prev.filter((ins) => ins.id !== process.id))
    }

    if (isCustomAsk(process)) {
      const CustomComp = process.component
      return <CustomComp key={process.id} {...process} onUpdate={onUpdate} onDispose={onDispose} />
    }
    return (
      <AskDialogDefault key={process.id} {...process} onUpdate={onUpdate} onDispose={onDispose} />
    )
  })
}

export type AskDialogProps<T> = AskProcessCustom<T> & AskDialogExtraProps<AskProcessCustom<T>>

type AskDialogExtraProps<T> = {
  onUpdate: (process: T) => void
  onDispose: () => void
}

type WithDefaultConfirm<T> = Omit<T, "onConfirm"> & Pick<AskProcessDefault, "onConfirm">

const AskDialogGeneric = <T extends AskProcessBase>({
  onUpdate,
  onDispose,
  ..._process
}: WithDefaultConfirm<T & AskDialogExtraProps<T>>) => {
  const process = _process as T
  const { id, type, open, title, message, form, content, confirmText, cancelText, onCancel } =
    process
  const onConfirm = _process.onConfirm
  const t = useTranslation()
  const uid = useId()

  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => onDispose(), 300) // Wait for the closing animation to finish before disposing the process
      return () => clearTimeout(timer)
    }
  }, [open, onDispose])

  const handleConfirm = () => {
    onUpdate({ ...process, open: false })
    onConfirm?.()
  }

  return (
    <Dialog
      key={id}
      open={open}
      onOpenChange={(open) => {
        onUpdate({ ...process, open })
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
            <Button variant={type === "delete" ? "destructive" : undefined} onClick={handleConfirm}>
              {confirmText ?? t.common.confirm}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
const AskDialogDefault = memo(AskDialogGeneric) as unknown as typeof AskDialogGeneric

export const AskDialog = AskDialogGeneric as <T>(
  props: WithDefaultConfirm<AskDialogProps<T>>,
) => React.ReactElement
