import { useEffect, useId, useRef, useState } from 'react'
import type { InputHTMLAttributes, KeyboardEvent, TextareaHTMLAttributes } from 'react'
import { Field } from '../../components/field.tsx'
import ui from '../../components/ui.module.css'
import styles from './detail.module.css'
import type { Parsed } from './fields.ts'

type DraftFieldProps<T> = {
  label: string
  /** Read out after the label but not shown, for example " in km". */
  hiddenLabelSuffix?: string
  /** A unit shown inside the right edge of the field, for example "km". */
  suffix?: string
  hint?: string
  /** The value to show: the stored one, or an entered one whose save failed. */
  value: T
  /** `value` was entered but could not be stored. */
  notSaved: boolean
  disabled: boolean
  parse: (text: string) => Parsed<T>
  format: (value: T) => string
  /** Shown under the field once the user has left it with text that cannot be understood. */
  errorText?: string
  /** Called on every keystroke with a value to save. The caller decides when it is written. */
  onEdit: (value: T) => void
  onInvalidChange?: (invalid: boolean) => void
  multiline?: boolean
  inputProps?: InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement>
}

/**
 * A typed field that saves as the user types. While it is being edited it
 * shows exactly what was typed; once left, it shows the stored value in its
 * tidy form. Text that cannot be understood is never saved: the field keeps
 * it on screen, says what is wrong after the user leaves it, and says what is
 * stored instead.
 */
export function DraftField<T>({
  label,
  hiddenLabelSuffix,
  suffix,
  hint,
  value,
  notSaved,
  disabled,
  parse,
  format,
  errorText,
  onEdit,
  onInvalidChange,
  multiline = false,
  inputProps,
}: DraftFieldProps<T>) {
  const id = useId()
  /** The text as typed, or null when the field is not being edited. */
  const [draft, setDraft] = useState<string | null>(null)
  const [showError, setShowError] = useState(false)
  /** The value from before this round of editing began. */
  const before = useRef(value)

  const invalid = draft !== null && !parse(draft).ok
  const errorVisible = showError && invalid

  useEffect(() => {
    onInvalidChange?.(invalid)
  }, [invalid, onInvalidChange])

  function handleInput(text: string) {
    if (draft === null) before.current = value
    setDraft(text)
    const parsed = parse(text)
    if (parsed.ok) {
      setShowError(false)
      onEdit(parsed.value)
    } else {
      // Put back what was there before editing began. Otherwise the start of a
      // mistyped entry ("12," on the way to "12,,4") would stay saved as if it
      // were the answer, with no error ever shown if the screen is left now.
      onEdit(before.current)
    }
  }

  function handleBlur() {
    if (draft === null) return
    if (parse(draft).ok) setDraft(null)
    else setShowError(true)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter finishes a one-line field and closes the keyboard. While an input
    // method is still composing, Enter belongs to it.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.blur()
  }

  const stored = format(value)
  const savedNote = !errorVisible
    ? undefined
    : stored === ''
      ? 'Nothing is saved for this field yet.'
      : `Saved value: ${suffix ? `${stored} ${suffix}` : stored}.`

  return (
    <Field
      label={label}
      hiddenLabelSuffix={hiddenLabelSuffix}
      htmlFor={id}
      hint={hint}
      error={errorVisible ? errorText : undefined}
      savedNote={savedNote}
      notSaved={notSaved}
    >
      {(describedBy) => {
        const shared = {
          id,
          value: draft ?? stored,
          disabled,
          'aria-describedby': describedBy,
          'aria-invalid': errorVisible || undefined,
          onBlur: handleBlur,
        }
        if (multiline) {
          return (
            <textarea
              {...inputProps}
              {...shared}
              className={`${ui.input} ${styles.notes}`}
              onChange={(event) => handleInput(event.currentTarget.value)}
            />
          )
        }
        return (
          <div className={styles.control}>
            <input
              {...inputProps}
              {...shared}
              type="text"
              className={suffix ? `${ui.input} ${styles.withSuffix}` : ui.input}
              onChange={(event) => handleInput(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
            />
            {suffix && (
              <span className={styles.suffix} aria-hidden="true">
                {suffix}
              </span>
            )}
          </div>
        )
      }}
    </Field>
  )
}
