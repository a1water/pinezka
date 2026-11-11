import { collections } from '../../collections/index.ts'
import { PinIcon } from '../../components/icons.tsx'
import { ScreenHeader } from '../../components/screen-header.tsx'
import styles from '../../components/ui.module.css'

/**
 * Settings has nothing to set yet. Map credits, backup, storage and install
 * help each arrive as a further section above About.
 */
export function SettingsScreen() {
  const first = collections[0]

  return (
    <>
      <ScreenHeader title="Settings" />
      <p className={styles.lead}>Nothing to set up yet.{first && ` Open ${first.title} to start.`}</p>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>About</h2>
        <p className={styles.brand}>
          <PinIcon className={styles.brandPin} size={28} />
          Pinezka
        </p>
        <p>Everything you enter is kept on this phone only.</p>
        {/* The phone check after a deploy looks for this line to see which build is open. */}
        <p className={styles.build}>Build {__BUILD_ID__}</p>
      </section>
    </>
  )
}
