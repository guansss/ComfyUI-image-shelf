import { ComponentProps, createContext, FocusEvent, MouseEvent, useContext, useState } from "react"

import { Autocomplete, AutocompleteInput } from "../reui/autocomplete"

type OpenChangeEvent = Parameters<
  NonNullable<ComponentProps<typeof Autocomplete>["onOpenChange"]>
>[1]

type OpenChangeHandler = (
  open: boolean,
  e: OpenChangeEvent | MouseEvent<HTMLInputElement> | FocusEvent<HTMLInputElement>,
) => void

const AutocompleteContext = createContext<{ onOpenChange: OpenChangeHandler } | null>(null)

export function AdvancedAutocomplete({
  open,
  onOpenChange,
  ...props
}: Omit<ComponentProps<typeof Autocomplete>, "onOpenChange"> & {
  onOpenChange?: OpenChangeHandler
}) {
  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = useState(!!open)

  const handleChange: OpenChangeHandler = (newOpen, e) => {
    if (!isControlled) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen, e)
  }

  return (
    <AutocompleteContext.Provider value={{ onOpenChange: handleChange }}>
      <Autocomplete
        open={isControlled ? open : internalOpen}
        onOpenChange={handleChange}
        {...props}
      />
    </AutocompleteContext.Provider>
  )
}

export function AdvancedAutocompleteInput({
  onClick,
  onFocus,
  ...props
}: ComponentProps<typeof AutocompleteInput>) {
  const { onOpenChange } = useContext(AutocompleteContext) ?? {}

  return (
    <AutocompleteInput
      onClick={(e) => {
        onClick?.(e)
        onOpenChange?.(true, e)
      }}
      onFocus={(e) => {
        onFocus?.(e)
        onOpenChange?.(true, e)
      }}
      {...props}
    />
  )
}
