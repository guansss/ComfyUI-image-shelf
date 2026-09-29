import { useState } from "react"

import { i18n, useTranslation } from "../../i18n/i18n"
import { errorToast } from "../../lib/error"
import { TransferConflict } from "../../services/gallery"
import { ask, AskDialog, AskRenderProps } from "../ask"
import { Field, FieldGroup, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"

type Replacements = Map<TransferConflict, string>

export function askConflictFilenames(conflicts: TransferConflict[], total: number) {
  return ask<{ replacements: Replacements }>({
    type: "custom",
    title: i18n.transfer.customize,
    message: i18n.transfer.conflictDetails({ count: conflicts.length, total }),
    render: (props) => <AskConflictFilenames {...props} conflicts={conflicts} />,
  })
}

function AskConflictFilenames({
  initialValue,
  conflicts,
  onConfirm,
  ...props
}: AskRenderProps<{ replacements: Replacements }> & {
  conflicts: TransferConflict[]
}) {
  const t = useTranslation()
  const [replacements, setReplacements] = useState(
    conflicts.reduce<Replacements>((acc, conflict) => {
      acc.set(conflict, conflict.suggested_filename)
      return acc
    }, new Map()),
  )

  return (
    <AskDialog
      {...props}
      size="medium"
      form={true}
      content={
        <FieldGroup>
          {conflicts.map((conflict) => (
            <Field key={JSON.stringify(conflict)}>
              <FieldLabel>
                <span>{t.transfer.filename}</span>
                <span className="text-muted-foreground italic truncate">{conflict.filename}</span>
              </FieldLabel>
              <Input
                aria-invalid={!replacements.get(conflict)}
                value={replacements.get(conflict) ?? ""}
                onChange={(e) =>
                  setReplacements((prev) => new Map(prev).set(conflict, e.target.value))
                }
              />
            </Field>
          ))}
        </FieldGroup>
      }
      onConfirm={() => {
        const hasEmptyNames = Array.from(replacements.entries()).some(([_, value]) => !value)
        if (hasEmptyNames) {
          errorToast({
            title: t.transfer.customize,
            message: i18n.error.required({ field: i18n.transfer.filename }),
          })
          return false
        }
        return onConfirm?.({ replacements })
      }}
    />
  )
}
