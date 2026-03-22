# Product Guidelines: Tessera

## Aesthetic Standards (B&W Minimalist)
- **Colors**: Black (#000000) and White (#FFFFFF) ONLY.
- **Motion**: Zero. No transitions, no hover fades, no loading spinners (use static labels).
- **Readability**: High contrast is mandatory.

## Performance Standards
- **Presence**: Real-time status indicators must be accurate within ~15s.
- **Concurrency**: Scale to multiple partners via Redis.
- **Audit**: All changes logged with granular diffs.
