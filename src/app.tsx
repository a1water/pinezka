import styles from './app.module.css'

export function App() {
  return (
    <main className={styles.page}>
      <svg className={styles.pin} viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 4c-11 0-20 8.7-20 19.5C12 38 32 60 32 60s20-22 20-36.5C52 12.7 43 4 32 4z" />
        <circle cx="32" cy="23.5" r="7.5" />
      </svg>
      <h1 className={styles.title}>Pinezka</h1>
      <p className={styles.lead}>Warsaw's 18 districts are on the way.</p>
      <p className={styles.build}>Build {__BUILD_ID__}</p>
    </main>
  )
}
