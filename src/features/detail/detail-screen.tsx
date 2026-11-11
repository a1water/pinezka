import { useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, FocusEvent } from 'react'
import type { Collection, PlaceDefinition } from '../../collections/index.ts'
import { Field } from '../../components/field.tsx'
import { CheckIcon, ExternalLinkIcon, WarningIcon } from '../../components/icons.tsx'
import { LoadState } from '../../components/load-state.tsx'
import { ScreenHeader } from '../../components/screen-header.tsx'
import ui from '../../components/ui.module.css'
import { isCalendarDate } from '../../data/db.ts'
import type { PlacePatch } from '../../data/db.ts'
import { placeStore, usePlaceStore } from '../../data/place-store.ts'
import type { SavePhase } from '../../data/place-store.ts'
import type { Place } from '../../data/types.ts'
import { goBack, listHash } from '../../router.ts'
import styles from './detail.module.css'
import { DraftField } from './draft-field.tsx'
import { kmText, parseKm, parseLink, today, webLink } from './fields.ts'
import type { Parsed } from './fields.ts'

type DetailScreenProps = { collection: Collection; place: PlaceDefinition; placeId: string }

// Notes are stored exactly as typed.
const asTyped = (text: string): Parsed<string> => ({ ok: true, value: text })
const sameText = (text: string): string => text

/**
 * One place and everything the user records about it. There is no save
 * button: every change is saved as it is made, and the word beside the name
 * says how that went.
 */
export function DetailScreen({ collection, place, placeId }: DetailScreenProps) {
  const status = usePlaceStore((state) => state.status)
  const record = usePlaceStore((state) => state.places.get(placeId))
  const unsaved = usePlaceStore((state) => state.unsaved.get(placeId))
  const phase = usePlaceStore((state) => state.save.phase)
  const saves = usePlaceStore((state) => state.saves.get(placeId) ?? 0)
  // "Saved" is about this visit to this place only, so it is measured from
  // the number of saves the place had when the screen opened.
  const [savesAtOpen] = useState(() => placeStore.getState().saves.get(placeId) ?? 0)
  const [invalidKm, setInvalidKm] = useState(false)
  const [invalidLink, setInvalidLink] = useState(false)

  // Leaving the screen by any way (the phone's back button, a tab, a link)
  // sends what was typed last without waiting for the pause. An input that
  // disappears while it has focus gets no blur event, so the form's own
  // handler does not cover this.
  useEffect(() => () => void placeStore.flush(), [])

  return (
    <>
      <ScreenHeader
        title={place.name}
        titleLang="pl"
        back={{ label: `Back to ${collection.title}`, onBack: () => goBack(listHash(collection.id)) }}
        status={<SaveStatus phase={phase} invalid={invalidKm || invalidLink} saved={saves !== savesAtOpen} />}
      />
      {status === 'ready' && record ? (
        <DetailForm
          collection={collection}
          placeId={placeId}
          record={record}
          unsaved={unsaved}
          blocked={phase === 'blocked'}
          onInvalidKm={setInvalidKm}
          onInvalidLink={setInvalidLink}
        />
      ) : (
        // The fields appear only with the data: text typed into fields that
        // the loaded values then replace would be lost.
        <LoadState />
      )}
    </>
  )
}

type SaveStatusProps = {
  phase: SavePhase
  /** A field holds text that cannot be saved. */
  invalid: boolean
  /** Something on this screen was saved during this visit. */
  saved: boolean
}

/** The word at the right of the place name: how saving is going. */
function SaveStatus({ phase, invalid, saved }: SaveStatusProps) {
  const stopped = phase === 'failed' || phase === 'blocked'
  const word = stopped || invalid ? 'Not saved' : phase === 'saving' ? 'Saving…' : saved ? 'Saved' : ''

  // What a screen reader is told. The visible word changes with every pause
  // in typing, and read out it would talk over the typing. So the spoken text
  // stays as it is while a save is on its way: "Saved" is announced once, not
  // after each save. A failed save is left to the alert.
  const [spoken, setSpoken] = useState('')
  const speak = stopped ? '' : invalid ? 'Not saved' : phase === 'saving' ? spoken : saved ? 'Saved' : ''
  // It depends on what was spoken before, so it is kept as state and brought
  // up to date while drawing; React then draws again at once with the new text.
  if (speak !== spoken) setSpoken(speak)

  return (
    <>
      <p
        className={word === 'Not saved' ? `${styles.saveStatus} ${styles.saveStatusStrong}` : styles.saveStatus}
        aria-hidden="true"
        data-testid="save-status"
      >
        {word === 'Not saved' && <WarningIcon className={styles.statusWarning} size={16} />}
        {word === 'Saved' && <CheckIcon size={14} />}
        {word}
      </p>
      <p className={ui.visuallyHidden} role="status">
        {spoken}
      </p>
    </>
  )
}

type DetailFormProps = {
  collection: Collection
  placeId: string
  /** The place as stored, with edits that are being saved. */
  record: Place
  /** Edits of this place whose save failed. */
  unsaved: PlacePatch | undefined
  /** This copy of the app can no longer save. */
  blocked: boolean
  onInvalidKm: (invalid: boolean) => void
  onInvalidLink: (invalid: boolean) => void
}

function DetailForm({ collection, placeId, record, unsaved, blocked, onInvalidKm, onInvalidLink }: DetailFormProps) {
  // An edit whose save failed stays on screen here, marked "Not saved", so
  // nothing the user typed disappears. The list and the totals show `record`.
  const shown: Place = unsaved ? { ...record, ...unsaved } : record
  const notSaved = (key: keyof PlacePatch) => unsaved !== undefined && key in unsaved

  // A collection whose places are done through trips has no tick and no date of its own.
  const ticked = !collection.usesTrips
  const untouched =
    !shown.done && shown.date === null && shown.km === null && shown.stravaUrl === '' && shown.notes === ''
  // Checked again on every draw: an imported backup could put any text in the field.
  const link = webLink(shown.stravaUrl)

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => event.preventDefault()}
      // Leaving a field saves it at once. Blur events of the fields reach the form.
      onBlur={() => void placeStore.flush()}
    >
      {ticked && untouched && (
        <p className={styles.intro}>{`Been here? Tick ${collection.doneWord} below and fill in the details.`}</p>
      )}

      {ticked && (
        <DateField
          value={shown.date}
          notSaved={notSaved('date')}
          disabled={blocked}
          onEdit={(date) => placeStore.edit(placeId, { date }, 'now')}
        />
      )}

      {collection.fields.includes('km') && (
        <DraftField
          label="Distance"
          hiddenLabelSuffix=" in km"
          suffix="km"
          value={shown.km}
          notSaved={notSaved('km')}
          disabled={blocked}
          parse={parseKm}
          format={kmText}
          errorText="Enter the distance as a number, like 12.4 or 12,4."
          onEdit={(km) => placeStore.edit(placeId, { km }, 'soon')}
          onInvalidChange={onInvalidKm}
          // Text with a decimal keypad, not a number field: a number field
          // reports "12,4" and unfinished text as empty.
          inputProps={{
            inputMode: 'decimal',
            enterKeyHint: 'done',
            autoComplete: 'off',
            maxLength: 8,
            placeholder: 'e.g. 12.4',
          }}
        />
      )}

      {collection.fields.includes('stravaUrl') && (
        <div className={styles.linkField}>
          <DraftField
            label="Strava link"
            hint="Optional"
            value={shown.stravaUrl}
            notSaved={notSaved('stravaUrl')}
            disabled={blocked}
            parse={parseLink}
            format={sameText}
            errorText="That is not a link. Paste the full address, like https://www.strava.com/activities/123."
            onEdit={(stravaUrl) => placeStore.edit(placeId, { stravaUrl }, 'soon')}
            onInvalidChange={onInvalidLink}
            inputProps={{
              inputMode: 'url',
              enterKeyHint: 'done',
              autoCapitalize: 'none',
              autoCorrect: 'off',
              spellCheck: false,
              autoComplete: 'off',
              maxLength: 2000,
              placeholder: 'Paste the activity link',
            }}
          />
          {link !== null && (
            // Opened only by the user's own tap; the app itself requests nothing.
            <a className={styles.openLink} href={link} target="_blank" rel="noopener noreferrer">
              Open link
              <ExternalLinkIcon size={18} />
              <span className={ui.visuallyHidden}> (opens in a new tab)</span>
            </a>
          )}
        </div>
      )}

      <DraftField
        label="Notes"
        value={shown.notes}
        notSaved={notSaved('notes')}
        disabled={blocked}
        parse={asTyped}
        format={sameText}
        onEdit={(notes) => placeStore.edit(placeId, { notes }, 'soon')}
        multiline
        inputProps={{ rows: 3, enterKeyHint: 'enter', placeholder: 'Route, weather, how it went…' }}
      />

      {/* The photos go here, between the notes and the tick. */}

      {ticked && (
        <DoneDock
          doneWord={collection.doneWord}
          done={shown.done}
          notSaved={notSaved('done')}
          disabled={blocked}
          // A date or distance without the tick does not count yet, and the user should know.
          reminder={!shown.done && (shown.date !== null || shown.km !== null)}
          onEdit={(done) => placeStore.edit(placeId, { done }, 'now')}
        />
      )}
    </form>
  )
}

type DateFieldProps = {
  value: string | null
  notSaved: boolean
  disabled: boolean
  onEdit: (date: string | null) => void
}

/** The day of the run, picked with the phone's own date picker. No day after today. */
function DateField({ value, notSaved, disabled, onEdit }: DateFieldProps) {
  const id = useId()
  // What the control itself holds while that cannot be saved: a date typed
  // half-way on a keyboard, or one out of range. Without it the control would
  // be put back to the stored date after every key, and no year could be typed.
  // The phone's picker only ever hands over a whole date within range.
  const [typed, setTyped] = useState<string | null>(null)
  const [outOfRange, setOutOfRange] = useState(false)
  /** The date from before this round of editing began. */
  const before = useRef(value)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    setOutOfRange(false)
    // Half-typed (the browser reports no value yet) or not within range yet:
    // not a date to save, and no complaint before the user has finished.
    if (!input.validity.valid) {
      setTyped(input.validity.badInput ? '' : input.value)
      // A keyboard changes a date one part at a time, and each step on the
      // way may be a real date that was saved. When the whole date turns out
      // to be refused, the date from before must be the one that stays, not a
      // step in between that the user never meant.
      if (!input.validity.badInput) onEdit(before.current)
      return
    }
    setTyped(null)
    // Empty is the picker's Clear button.
    if (input.value === '') onEdit(null)
    else if (isCalendarDate(input.value)) onEdit(input.value)
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    // The field goes back to showing what is stored. If a whole date was
    // entered and refused, the message says why it is gone.
    const { validity } = event.currentTarget
    setOutOfRange(!validity.valid && !validity.badInput)
    setTyped(null)
  }

  return (
    <Field
      label="Date"
      htmlFor={id}
      error={outOfRange ? 'Pick a real date, today or earlier.' : undefined}
      notSaved={notSaved}
    >
      {(describedBy) => (
        <input
          id={id}
          className={ui.input}
          type="date"
          min="1900-01-01"
          max={today()}
          value={typed ?? value ?? ''}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={outOfRange || undefined}
          onFocus={() => {
            before.current = value
          }}
          onChange={handleChange}
          onBlur={handleBlur}
        />
      )}
    </Field>
  )
}

type DoneDockProps = {
  doneWord: string
  done: boolean
  notSaved: boolean
  disabled: boolean
  /** Say that the place is not counted until it is ticked. */
  reminder: boolean
  onEdit: (done: boolean) => void
}

/**
 * The tick, as a wide bar that stays just above the tab bar, where the thumb
 * is. It is the last thing in the form, so its place on screen and its place
 * in reading order are the same.
 */
function DoneDock({ doneWord, done, notSaved, disabled, reminder, onEdit }: DoneDockProps) {
  const tagId = useId()

  return (
    <div className={styles.dock}>
      {reminder && (
        <p className={styles.dockHint}>{`Not ticked yet. Tick ${doneWord} to count it.`}</p>
      )}
      <div className={styles.doneWrap}>
        <label className={styles.doneBar}>
          <input
            className={styles.doneInput}
            type="checkbox"
            checked={done}
            disabled={disabled}
            aria-describedby={notSaved ? tagId : undefined}
            onChange={(event) => onEdit(event.currentTarget.checked)}
          />
          <span className={styles.tickBox} aria-hidden="true">
            <CheckIcon size={20} />
          </span>
          {doneWord}
        </label>
        {/* Beside the label, not inside it, so the checkbox is still named just "Done". */}
        {notSaved && (
          <span className={`${ui.tag} ${styles.doneTag}`} id={tagId}>
            Not saved
          </span>
        )}
      </div>
    </div>
  )
}
