// GitHub Pages serves the app under /<repository>/. The deploy workflow passes
// that path in BASE_PATH; without it the app is served from the root.
// Shared by the Vite and Playwright configs so both always agree.
export function basePath(): string {
  const raw = process.env.BASE_PATH?.trim()
  if (!raw || raw === '/') return '/'
  const path = `/${raw.replace(/^\/+|\/+$/g, '')}/`
  if (!/^\/([\w.-]+\/)+$/.test(path)) {
    throw new Error(
      `BASE_PATH must look like "/repository/", got ${JSON.stringify(raw)}. ` +
        'Git Bash rewrites values that start with "/": prefix the command with MSYS_NO_PATHCONV=1 or use PowerShell.',
    )
  }
  return path
}
