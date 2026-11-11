import type { ReactNode } from 'react'
import styles from './ui.module.css'

type FieldProps = {
  label: string
  /** Read out after the label but not shown, for example " in km". */
  hiddenLabelSuffix?: string
  /** The id of the control. The ids of the texts around it are built from it. */
  htmlFor: string
  /** A short remark at the right of the label, such as "Optional". */
  hint?: string
  error?: string
  /** What is stored while the control shows text that cannot be saved. */
  savedNote?: string
  /** The value on screen was entered but could not be stored. */
  notSaved?: boolean
  /** Draws the control. It must put the given ids in its `aria-describedby`. */
  children: (describedBy: string | undefined) => ReactNode
}

/** A labelled control with the texts that belong to it: hint, error and what is saved. */
export function Field({ label, hiddenLabelSuffix, htmlFor, hint, error, savedNote, notSaved, children }: FieldProps) {
  const tagId = `${htmlFor}-tag`
  const hintId = `${htmlFor}-hint`
  const errorId = `${htmlFor}-error`
  const noteId = `${htmlFor}-note`
  const showTag = notSaved === true
  const showHint = hint !== undefined && !showTag
  const describedBy = [
    showTag ? tagId : '',
    showHint ? hintId : '',
    error !== undefined ? errorId : '',
    savedNote !== undefined ? noteId : '',
  ]
    .filter((id) => id !== '')
    .join(' ')

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
          {hiddenLabelSuffix && <span className={styles.visuallyHidden}>{hiddenLabelSuffix}</span>}
        </label>
        {/*
          The tag sits above the control, not under it: under it, it would be
          behind the keyboard at the very moment a save fails while typing.
        */}
        {showTag && (
          <span className={styles.tag} id={tagId}>
            Not saved
          </span>
        )}
        {showHint && (
          <span className={styles.hint} id={hintId}>
            {hint}
          </span>
        )}
      </div>
      {children(describedBy === '' ? undefined : describedBy)}
      {error !== undefined && (
        <p className={styles.fieldNote} id={errorId}>
          {error}
        </p>
      )}
      {savedNote !== undefined && (
        <p className={styles.fieldNote} id={noteId}>
          {savedNote}
        </p>
      )}
    </div>
  )
}
