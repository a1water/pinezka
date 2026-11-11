import { CheckIcon, PinIcon, PinOutlineIcon } from '../../components/icons.tsx'
import ui from '../../components/ui.module.css'
import { formatDay } from '../detail/fields.ts'
import styles from './list.module.css'

type PlaceCardProps = {
  href: string
  /** Polish name. */
  name: string
  done: boolean
  date: string | null
  /** What a finished place is called: "Done" or "Visited". */
  doneWord: string
  /** The place's cover photo, once places have photos. */
  coverUrl?: string
}

/**
 * One place in the list. The whole card is the link, and a screen reader
 * hears its parts in order: "Mokotów Done 8 Nov 2026" or "Ochota Not done".
 * Each part is a block or is taken out of the line, which is what puts the
 * spaces between them in that name.
 */
export function PlaceCard({ href, name, done, date, doneWord, coverUrl }: PlaceCardProps) {
  return (
    <li className={styles.cell}>
      <a className={styles.card} href={href}>
        <PlaceCover done={done} coverUrl={coverUrl} />
        <span className={styles.cardBody}>
          <span className={styles.name} lang="pl">
            {name}
          </span>
          {/* Drawn over the cover's corner, but read after the name. */}
          {done ? (
            <span className={styles.badge}>
              <CheckIcon size={14} />
              {doneWord}
            </span>
          ) : (
            <span className={ui.visuallyHidden}>Not {doneWord.toLowerCase()}</span>
          )}
          {/* Kept when there is no date, so the cards of a row are equally tall. */}
          <span className={styles.meta}>{date !== null && formatDay(date)}</span>
        </span>
      </a>
    </li>
  )
}

/** The picture area of a card. Without a photo it shows the pin: filled when the place is done. */
function PlaceCover({ done, coverUrl }: { done: boolean; coverUrl?: string }) {
  if (coverUrl !== undefined) {
    return (
      <span className={styles.cover} aria-hidden="true">
        <img className={styles.coverImage} src={coverUrl} alt="" loading="lazy" decoding="async" />
      </span>
    )
  }
  return (
    <span className={done ? `${styles.cover} ${styles.coverDone}` : styles.cover} aria-hidden="true">
      {done ? <PinIcon size={36} /> : <PinOutlineIcon size={36} />}
    </span>
  )
}
