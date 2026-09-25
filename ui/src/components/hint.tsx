import { useAtom } from "jotai"
import { compact, uniq } from "lodash-es"
import { PlayIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { ComfyApiWorkflow, LGraphNode } from "../comfy-shims"
import { getDriver } from "../driver/driver"
import { useTranslation } from "../i18n/i18n"
import { forEachNode } from "../lib/comfy"
import { errorToast, formatError } from "../lib/error"
import {
  createPromptHint,
  PromptHintSetting,
  promptHintsSchema,
  settingsAtom,
} from "../lib/settings"
import { toast } from "../lib/toast"
import { ImageMetadata, parseMetadataFromWorkflow, PromptParseResult } from "../services/gallery"
import { AdvancedAutocomplete, AdvancedAutocompleteInput } from "./custom/advanced-autocomplete"
import { ComfyPrompts } from "./gallery/ImageViewer"
import { AutocompleteContent, AutocompleteItem, AutocompleteList } from "./reui/autocomplete"
import { Checkbox } from "./ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "./ui/field"
import { ScrollArea } from "./ui/scroll-area"
import { Separator } from "./ui/separator"
import { Spinner } from "./ui/spinner"

type PromptHintFieldErrors = Partial<Record<keyof PromptHintSetting, string>>
type PromptHintValidationErrors = Record<number, PromptHintFieldErrors>

interface HintEditorDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export function HintEditorDialog({ isOpen, onOpenChange }: HintEditorDialogProps) {
  const t = useTranslation()
  const [settings, setSettings] = useAtom(settingsAtom)
  const [hints, setHints] = useState<PromptHintSetting[]>(() => settings.prompt_hints ?? [])
  const [isSavingHints, setIsSavingHints] = useState(false)
  const [promptHintErrors, setPromptHintErrors] = useState<PromptHintValidationErrors>({})

  const nodes = useMemo(() => getNodes(), [])

  const validateHints = () => {
    const validation = promptHintsSchema.safeParse(hints)
    if (!validation.success) {
      const errors: PromptHintValidationErrors = {}
      for (const issue of validation.error.issues) {
        const [hintIndex, field] = issue.path
        if (typeof hintIndex !== "number" || typeof field !== "string") continue
        errors[hintIndex] = {
          ...errors[hintIndex],
          [field as keyof PromptHintSetting]: issue.message,
        }
      }
      setPromptHintErrors(errors)
      return false
    }
    setPromptHintErrors({})
    return true
  }

  const saveHints = async () => {
    if (!validateHints()) return
    try {
      setIsSavingHints(true)
      setPromptHintErrors({})
      await setSettings({ prompt_hints: hints })
      toast({ type: "success", title: t.common.saved })
    } catch (e) {
      console.warn("Failed to save hints:", e)
      errorToast({
        title: t.common.saveFailed,
        message: formatError(e),
      })
    } finally {
      setIsSavingHints(false)
    }
  }

  const updateHint = (id: string, update: Partial<PromptHintSetting>) => {
    setHints((current) => current.map((hint) => (hint.id === id ? { ...hint, ...update } : hint)))
    setPromptHintErrors({})
  }

  const deleteHint = (id: string) => {
    setHints((current) => current.filter((hint) => hint.id !== id))
    setPromptHintErrors({})
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="w-300 h-200 grid-rows-[auto_1fr_auto] gap-0">
        <DialogHeader>
          <DialogTitle>{t.hint.editHint}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="min-h-0 mt-4 -mx-4">
          <section className="flex flex-wrap gap-4 p-4">
            {hints.map((hint, index) => (
              <HintItem
                key={hint.id}
                nodes={nodes}
                hint={hint}
                errors={promptHintErrors[index]}
                onUpdate={updateHint}
                onDelete={deleteHint}
              />
            ))}
            <Button
              variant="outline"
              onClick={() => setHints((current) => [...current, createPromptHint()])}
              type="button"
            >
              <PlusIcon data-icon="inline-start" />
              {t.hint.addHint}
            </Button>
          </section>
          <Separator className="w-auto mx-4" />
          <MetadataPreview hints={hints} validateHints={validateHints} />
        </ScrollArea>
        <DialogFooter className="py-3">
          <Button disabled={isSavingHints} onClick={saveHints} type="button">
            {isSavingHints ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HintItem({
  nodes,
  hint,
  onUpdate,
  onDelete,
  errors,
}: {
  nodes: LGraphNode[]
  hint: PromptHintSetting
  errors?: PromptHintFieldErrors
  onUpdate: (id: string, updatedHint: Partial<PromptHintSetting>) => void
  onDelete: (id: string) => void
}) {
  const t = useTranslation()
  const nodeClassOptions = uniq(compact(nodes.map((node) => node.comfyClass)))

  const matchedNodes = hint.class_type
    ? nodes.filter((node) => node.comfyClass === hint.class_type)
    : []
  const nodeInputOptions = matchedNodes.flatMap((node) => node.inputs.map((input) => input.name))

  return (
    <div key={hint.id} className="flex flex-col gap-2 rounded-lg border p-2">
      <Field>
        <FieldLabel htmlFor={`prompt-hint-class-${hint.id}`}>{t.hint.hintClassType}</FieldLabel>
        <AdvancedAutocomplete
          items={nodeClassOptions}
          value={hint.class_type}
          onValueChange={(newValue) => onUpdate(hint.id, { class_type: newValue })}
          mode="none"
        >
          <AdvancedAutocompleteInput
            id={`prompt-hint-class-${hint.id}`}
            aria-invalid={!!errors?.class_type}
          />
          <AutocompleteContent className="pointer-events-auto">
            <AutocompleteList>
              {(nodeClass: string) => (
                <AutocompleteItem key={nodeClass} value={nodeClass} className="rounded-lg">
                  {nodeClass}
                </AutocompleteItem>
              )}
            </AutocompleteList>
          </AutocompleteContent>
        </AdvancedAutocomplete>
        {errors?.class_type && (
          <FieldDescription className="text-red-500">{errors.class_type}</FieldDescription>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={`prompt-hint-input-${hint.id}`}>{t.hint.hintInputName}</FieldLabel>
        <AdvancedAutocomplete
          items={nodeInputOptions}
          value={hint.input_name}
          onValueChange={(newValue) => onUpdate(hint.id, { input_name: newValue })}
          mode="none"
        >
          <AdvancedAutocompleteInput
            id={`prompt-hint-input-${hint.id}`}
            aria-invalid={!!errors?.input_name}
          />
          <AutocompleteContent className="pointer-events-auto">
            <AutocompleteList>
              {(inputName: string) => (
                <AutocompleteItem key={inputName} value={inputName} className="rounded-lg">
                  {inputName}
                </AutocompleteItem>
              )}
            </AutocompleteList>
          </AutocompleteContent>
        </AdvancedAutocomplete>
        {errors?.input_name && (
          <FieldDescription className="text-red-500">{errors.input_name}</FieldDescription>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field>
          <FieldLabel htmlFor={`prompt-hint-kind-${hint.id}`}>{t.hint.hintKind}</FieldLabel>
          <Select
            disabled={hint.ignore}
            value={hint.kind}
            onValueChange={(value) =>
              onUpdate(hint.id, {
                kind: value as PromptHintSetting["kind"],
              })
            }
          >
            <SelectTrigger id={`prompt-hint-kind-${hint.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">{t.hint.type.text}</SelectItem>
              <SelectItem value="conditioning">{t.hint.type.conditioning}</SelectItem>
            </SelectContent>
          </Select>
          {errors?.kind && (
            <FieldDescription className="text-red-500">{errors.kind}</FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={`prompt-hint-role-${hint.id}`}>{t.hint.hintRole}</FieldLabel>
          <Select
            disabled={hint.ignore}
            value={hint.role}
            onValueChange={(value) =>
              onUpdate(hint.id, {
                role: value as PromptHintSetting["role"],
              })
            }
          >
            <SelectTrigger id={`prompt-hint-role-${hint.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="positive">{t.hint.role.positive}</SelectItem>
              <SelectItem value="negative">{t.hint.role.negative}</SelectItem>
              <SelectItem value="unknown">{t.hint.role.unknown}</SelectItem>
            </SelectContent>
          </Select>
          {errors?.role && (
            <FieldDescription className="text-red-500">{errors.role}</FieldDescription>
          )}
        </Field>
      </div>
      <div className="flex items-center justify-between">
        <Field orientation="horizontal">
          <Checkbox
            id={`prompt-hint-ignore-${hint.id}`}
            checked={hint.ignore}
            onCheckedChange={(checked) => onUpdate(hint.id, { ignore: checked === true })}
          />
          <FieldLabel htmlFor={`prompt-hint-ignore-${hint.id}`}>{t.hint.hintIgnore}</FieldLabel>
        </Field>
        <Button
          variant="flat"
          size="icon-sm"
          title={t.common.delete}
          onClick={() => onDelete(hint.id)}
          type="button"
        >
          <Trash2Icon />
        </Button>
      </div>
    </div>
  )
}

function MetadataPreview({
  hints,
  validateHints,
}: {
  hints: PromptHintSetting[]
  validateHints: () => boolean
}) {
  const t = useTranslation()
  const [parsedMetadata, setParsedMetadata] = useState<ImageMetadata | undefined>()
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | undefined>()
  const [currentApiWorkflow, setCurrentApiWorkflow] = useState<ComfyApiWorkflow>()

  const currentWorkflowName = useMemo(() => getCurrentWorkflowName(), [])

  const parseCurrentWorkflow = async () => {
    if (!validateHints()) return

    setIsParsing(true)
    try {
      const workflows = await getDriver().getComfyApp().graphToPrompt()
      const metadata = await parseMetadataFromWorkflow({
        ui_workflow: workflows.workflow,
        api_workflow: workflows.output,
        hints,
      })
      setParsedMetadata(metadata)
      setCurrentApiWorkflow(workflows.output)

      if (metadata.parse_error) {
        setParseError(metadata.parse_error)
      } else {
        setParseError(undefined)
      }
    } catch (e) {
      console.warn("Failed to parse current workflow:", e)
      setParseError(formatError(e))
    } finally {
      setIsParsing(false)
    }
  }

  const parsedPrompt =
    parsedMetadata?.type === "comfy"
      ? (parsedMetadata.prompt as PromptParseResult | null)
      : undefined

  return (
    <section className="flex flex-col gap-2 p-4">
      <div className="flex gap-2 items-center">
        <Button variant="outline" onClick={parseCurrentWorkflow} disabled={isParsing}>
          {isParsing ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
          {t.hint.parseCurrentWorkflow}
        </Button>
        <span className="text-muted-foreground">{currentWorkflowName}</span>
      </div>
      {parseError && (
        <p className="text-red-500">
          {t.error.error}: {parseError}
        </p>
      )}
      {parsedPrompt && (
        <div className="-mx-4">
          <ComfyPrompts prompt={parsedPrompt} apiWorkflow={currentApiWorkflow} />
        </div>
      )}
    </section>
  )
}

function getNodes() {
  try {
    const graph = getDriver().getComfyApp().rootGraph
    const nodes: LGraphNode[] = []
    forEachNode(graph, (node) => nodes.push(node))
    return nodes
  } catch (e) {
    console.error("Failed to get Comfy nodes", e)
    return []
  }
}

function getCurrentWorkflowName() {
  try {
    return getDriver().getComfyApp().extensionManager.workflow.activeWorkflow?.filename
  } catch (e) {
    console.error("Failed to get current workflow name", e)
    return undefined
  }
}
