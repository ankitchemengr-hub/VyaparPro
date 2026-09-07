import * as React from "react"

import { Input } from "@/components/ui/input"

export interface NumberInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: number | null | undefined
  /** Called with the parsed number. Empty / partial input reports `emptyValue`. */
  onChange: (value: number) => void
  /** Value reported (and the field left visually empty) while there's no number. Default 0. */
  emptyValue?: number
}

/**
 * A controlled number field that can actually be emptied while typing.
 *
 * A plain `<Input type="number" value={someNumber}>` snaps an empty field back
 * to `0` on every keystroke (`Number("") === 0`), so a user who backspaces to
 * clear it is left fighting a stuck "0". This keeps the user's raw text while
 * the field is focused and only re-syncs to the numeric value on blur.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onChange, emptyValue = 0, onBlur, ...props }, ref) => {
    // null → show the controlled numeric value; string → show the user's draft.
    const [draft, setDraft] = React.useState<string | null>(null)

    const display = draft ?? (value == null ? "" : String(value))

    return (
      <Input
        {...props}
        ref={ref}
        type="number"
        inputMode="decimal"
        value={display}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
            onChange(emptyValue)
            return
          }
          const n = Number(raw)
          if (!Number.isNaN(n)) onChange(n)
        }}
        onBlur={(e) => {
          setDraft(null)
          onBlur?.(e)
        }}
      />
    )
  },
)
NumberInput.displayName = "NumberInput"
