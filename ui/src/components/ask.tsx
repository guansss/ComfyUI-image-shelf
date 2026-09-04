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

  /**
   * onConfirm: Returns false to prevent closing the dialog.
   */
}

interface AskRequestConfirm extends AskRequestBase {
  type: "confirm"
  onConfirm?: () => boolean | void
}

interface AskRequestDelete extends AskRequestBase {
  type: "delete"
  onConfirm?: () => boolean | void
}

type AskRequestDefault = AskRequestConfirm | AskRequestDelete

type AskRequestCustom<T, M> = AskRequestBase & {
  type: "custom"
  component: React.ComponentType<AskDialogProps<T, M>>
  initialValue?: T
  onConfirm?: (value: T) => boolean | void
} & ([M] extends [never] ? {} : { meta: M })

type AskRequest = AskRequestDefault | AskRequestCustom<unknown, unknown>

type AskProcessMeta = {
  id: string
  open: boolean
}
type AskProcessBase = AskRequestBase & AskProcessMeta
type AskProcessDefault = AskProcessBase & AskRequestDefault
type AskProcessCustom<T, M> = AskProcessBase & AskRequestCustom<T, M>
type AskProcess = AskProcessDefault | AskProcessCustom<unknown, unknown>

type AskEvents = {
  add: AskRequest
}

const emitter = mitt<AskEvents>()

type GetAskReturn<T> = T extends AskRequestDefault
  ? boolean
  : T extends AskRequestCustom<infer U, infer M>
    ? U | null
    : never

function askGeneric<T extends AskRequestBase>(req: T): Promise<GetAskReturn<T>> {
  return new Promise<unknown>((resolve) => {
    if (isCustomAsk(req)) {
      const customReq = req as unknown as AskRequestCustom<unknown, unknown>
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
      const defaultReq = req as AskRequestDefault
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

export type AskCustomParam<T, M = never> = Omit<AskRequestCustom<T, M>, "type">

export function askCustom<T, M = never>(req: AskCustomParam<T, M>): Promise<T | null> {
  const customReq = { ...req, type: "custom" } as AskRequestCustom<T, M>
  return askGeneric(customReq)
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
      setProcesses((prev) =>
        prev.map((ins) =>
          ins.id === newProcess.id
            ? // combine the existing process with the new process,
              // because a component that wraps the AskDialog may not
              // pass all the props to the AskDialog, which would cause
              // those props to be lost in the updated process
              ({ ...ins, ...newProcess } as typeof ins)
            : ins,
        ),
      )
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

export type AskDialogProps<T, M = never> = AskProcessCustom<T, M> &
  AskDialogExtraProps<AskProcessCustom<T, M>>

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
    const result = onConfirm?.()
    if (result !== false) onUpdate({ ...process, open: false })
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

export const AskDialog = AskDialogGeneric as <T, M = never>(
  props: WithDefaultConfirm<AskDialogProps<T, M>>,
) => React.ReactElement
