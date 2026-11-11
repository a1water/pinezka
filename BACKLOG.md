# Backlog

Ideas outside the version being built. Nothing here is started until asked for.

## Tooling

- **ESLint:** revisit when `typescript-eslint` supports TypeScript 7. Until then the project lints with Oxlint.
- **Type-aware lint rules:** `oxlint-tsgolint` adds rules such as "no floating promises", useful for the IndexedDB code. Its rule coverage is still incomplete.
- **Component tests:** the plan asks for unit tests of data and backup plus one phone-viewport smoke test. Tests that render React components would need a DOM test environment (jsdom), kept apart from the Blob tests.

## Place detail

- **"Today" shortcut:** a button beside the date field that fills in today's date. The phone's date picker already opens on today, so it would save one tap.
- **Distances with a comma:** show distances the way the phone's language writes them ("12,4 km" in Polish). The interface is English, so they are shown with a dot; typing accepts both.

## Later, in neither version (from PLAN.md)

- More collections on the same model, such as Poland's 16 voivodeship capitals
- Suggest the current district or country from the phone's location
- Prefill the date and city from the photo's own metadata
- Export a contact sheet of starred photos as a PDF for a photo book
- A shareable progress image
