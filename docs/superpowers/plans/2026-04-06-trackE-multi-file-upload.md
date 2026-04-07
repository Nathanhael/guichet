# Track E: Multi-File Upload + Broader File Types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support uploading up to 5 files per message (images + documents) with file cards for non-image types, replacing the current single-image-only upload.

**Architecture:** New `attachments` JSONB column on `messages`, new multi-upload endpoint, extended MIME types, `AttachmentGrid` client component, updated compose area with multi-file preview bar.

**Tech Stack:** React 19, TypeScript, Drizzle ORM, Express/Multer, Socket.io, Tailwind CSS

**Depends on:** Track 0 (ChatWindow decomposition)

---

### Task 1: Database migration — add `attachments` column

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Add the column**

In `server/db/schema.ts`, find the `messages` table. Add after `linkPreviews` (or after `deletedAt` if Track D hasn't shipped):

```ts
attachments: jsonb('attachments').$type<Array<{
  url: string;
  name: string;
  mimeType: string;
  size: number;
}>>(),
```

- [ ] **Step 2: Generate and apply migration**

```bash
docker compose exec server npx drizzle-kit generate
docker compose exec server npx drizzle-kit push
```

- [ ] **Step 3: Commit**

```bash
git add server/db/schema.ts server/drizzle/
git commit -m "feat(track-e): add attachments JSONB column to messages table"
```

---

### Task 2: Extend upload route for multi-file and new MIME types

**Files:**
- Modify: `server/routes/uploads.ts`
- Modify: `server/config.ts` (if MIME types are configured there)

- [ ] **Step 1: Verify/update allowed MIME types**

Check `server/config.ts` for `UPLOAD_ALLOWED_TYPES`. Ensure these are included:

```ts
UPLOAD_ALLOWED_TYPES: [
  'image/png', 'image/jpeg', 'image/webp',                    // existing
  'application/pdf',                                            // new
  'application/msword',                                         // new (.doc)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // new (.docx)
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // new (.xlsx)
  'application/vnd.ms-excel',                                   // new (.xls)
  'text/csv',                                                   // new
  'text/plain',                                                 // new (.txt)
],
```

If they're hardcoded in `uploads.ts` `fileFilter`, update there instead.

- [ ] **Step 2: Add multi-upload endpoint**

In `server/routes/uploads.ts`, add after the existing single-upload route:

```ts
/**
 * POST /api/v1/uploads/multi
 * Upload up to 5 files. Returns array of { url, name, mimeType, size }.
 */
router.post('/multi', auth, uploadRateLimit, (req: Request, res: Response) => {
  const multiUpload = multer({ storage, fileFilter, limits: { fileSize: config.UPLOAD_MAX_SIZE } })
    .array('files', 5);

  multiUpload(req, res, async (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `File too large (max ${config.UPLOAD_MAX_SIZE / 1024 / 1024}MB)` });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Too many files (max 5)' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files received' });
    }

    // Validate magic bytes for each file
    const results = [];
    for (const file of files) {
      const detected = await fileTypeFromFile(file.path);
      if (detected && !config.UPLOAD_ALLOWED_TYPES.includes(detected.mime)) {
        // Clean up the rejected file
        fs.unlinkSync(file.path);
        continue;
      }
      results.push({
        url: `/uploads/${file.filename}`,
        name: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });
    }

    if (results.length === 0) {
      return res.status(400).json({ error: 'No valid files' });
    }

    return res.json(results);
  });
});
```

- [ ] **Step 3: Typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/routes/uploads.ts server/config.ts
git commit -m "feat(track-e): add multi-file upload endpoint with extended MIME types"
```

---

### Task 3: Update socket handler to accept attachments

**Files:**
- Modify: `server/socket/handlers.ts`
- Modify: `server/utils/messageMapper.ts`

- [ ] **Step 1: Accept attachments in message:send**

In the `message:send` handler, destructure `attachments` from the payload:

```ts
const { ticketId, text, mediaUrl, whisper, replyToId, attachments } = data;
```

- [ ] **Step 2: Store attachments when inserting**

Include `attachments` in the message insert:
```ts
attachments: attachments || null,
```

- [ ] **Step 3: Include in messageMapper**

In `server/utils/messageMapper.ts`:
```ts
attachments: row.attachments || null,
```

- [ ] **Step 4: Typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts server/utils/messageMapper.ts
git commit -m "feat(track-e): accept attachments in message:send socket handler"
```

---

### Task 4: Update client Message type

**Files:**
- Modify: `client/src/types/index.ts`

- [ ] **Step 1: Add attachments to Message interface**

```ts
export interface Message {
  // ... existing fields
  attachments?: Array<{
    url: string;
    name: string;
    mimeType: string;
    size: number;
  }> | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/types/index.ts
git commit -m "feat(track-e): add attachments field to client Message type"
```

---

### Task 5: Create AttachmentGrid component

**Files:**
- Create: `client/src/components/chat/AttachmentGrid.tsx`

- [ ] **Step 1: Write the component**

```tsx
// client/src/components/chat/AttachmentGrid.tsx
import { FileText, Sheet, File, Download } from 'lucide-react';

interface Attachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

interface AttachmentGridProps {
  attachments: Attachment[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.includes('pdf')) return <FileText size={20} className="text-text-secondary" />;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return <Sheet size={20} className="text-text-secondary" />;
  return <File size={20} className="text-text-secondary" />;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export default function AttachmentGrid({ attachments }: AttachmentGridProps) {
  const images = attachments.filter((a) => isImage(a.mimeType));
  const documents = attachments.filter((a) => !isImage(a.mimeType));

  return (
    <div className="mt-1.5">
      {/* Image grid */}
      {images.length > 0 && (
        <div className={`grid gap-1 ${
          images.length === 1 ? 'grid-cols-1 max-w-[300px]' :
          images.length === 2 ? 'grid-cols-2 max-w-[400px]' :
          'grid-cols-2 max-w-[400px]'
        }`}>
          {images.map((img) => (
            <a
              key={img.url}
              href={img.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block border border-border overflow-hidden hover:opacity-80"
            >
              <img
                src={img.url}
                alt={img.name}
                className="w-full h-auto object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {/* Document file cards */}
      {documents.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          {documents.map((doc) => (
            <div
              key={doc.url}
              className="flex items-center gap-3 bg-bg-elevated border border-border px-3 py-2"
            >
              {getFileIcon(doc.mimeType)}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-mono text-[11px] text-text-primary truncate">
                  {doc.name}
                </span>
                <span className="text-[9px] text-text-secondary">
                  {formatSize(doc.size)}
                </span>
              </div>
              <a
                href={doc.url}
                download={doc.name}
                className="text-[8px] font-bold uppercase tracking-widest border border-border-heavy px-2 py-1 hover:bg-bg-surface text-text-primary no-underline shrink-0"
              >
                <Download size={12} />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Export from barrel**

Add to `client/src/components/chat/index.ts`:
```ts
export { default as AttachmentGrid } from './AttachmentGrid';
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/AttachmentGrid.tsx client/src/components/chat/index.ts
git commit -m "feat(track-e): add AttachmentGrid component with image grid and file cards"
```

---

### Task 6: Render AttachmentGrid in MessageBubble

**Files:**
- Modify: `client/src/components/MessageBubble.tsx`

- [ ] **Step 1: Import AttachmentGrid**

```ts
import { AttachmentGrid } from './chat';
```

- [ ] **Step 2: Add attachment rendering**

After the message text (and after link previews if Track D is applied), add:

```tsx
{/* Attachments — new format */}
{!isDeleted && message.attachments && message.attachments.length > 0 && (
  <AttachmentGrid attachments={message.attachments} />
)}

{/* Legacy single image — backward compat */}
{!isDeleted && !message.attachments && message.mediaUrl && (
  // ... keep existing single-image rendering
)}
```

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MessageBubble.tsx
git commit -m "feat(track-e): render AttachmentGrid in MessageBubble with legacy fallback"
```

---

### Task 7: Update ComposeArea for multi-file upload

**Files:**
- Modify: `client/src/components/chat/ComposeArea.tsx`

- [ ] **Step 1: Replace single-file state with multi-file state**

Replace:
```ts
const [mediaUrl, setMediaUrl] = useState<string | null>(null);
const [mediaPreview, setMediaPreview] = useState<string | null>(null);
```

With:
```ts
const [pendingFiles, setPendingFiles] = useState<Array<{
  file: File;
  preview: string; // blob URL for images, empty for documents
}>>([]);
const [uploading, setUploading] = useState(false);
```

- [ ] **Step 2: Update upload logic**

```ts
async function uploadFiles(): Promise<Array<{ url: string; name: string; mimeType: string; size: number }>> {
  if (pendingFiles.length === 0) return [];
  setUploading(true);
  try {
    const form = new FormData();
    pendingFiles.forEach(({ file }) => form.append('files', file));
    const res = await fetch('/api/v1/uploads/multi', {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) throw new Error('Upload failed');
    return await res.json();
  } finally {
    setUploading(false);
  }
}

function addFiles(files: FileList | File[]) {
  const newFiles = Array.from(files).slice(0, 5 - pendingFiles.length);
  if (newFiles.length === 0) return;

  const additions = newFiles.map((file) => ({
    file,
    preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
  }));

  setPendingFiles((prev) => [...prev, ...additions].slice(0, 5));
}

function removeFile(index: number) {
  setPendingFiles((prev) => {
    const removed = prev[index];
    if (removed.preview) URL.revokeObjectURL(removed.preview);
    return prev.filter((_, i) => i !== index);
  });
}
```

- [ ] **Step 3: Update file input**

Change the file input to accept multiple files and the new types:

```tsx
<input
  ref={fileRef}
  type="file"
  className="hidden"
  multiple
  accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
  onChange={(e) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = ''; // reset for re-selection
  }}
/>
```

- [ ] **Step 4: Add file preview bar**

Above the textarea (and below the reply banner if Track A is applied), add:

```tsx
{/* File preview bar */}
{pendingFiles.length > 0 && (
  <div className="flex items-center gap-2 px-4 py-2 bg-bg-elevated border-b border-border overflow-x-auto">
    {pendingFiles.map((pf, idx) => (
      <div key={idx} className="relative shrink-0">
        {pf.preview ? (
          <img src={pf.preview} alt="" className="w-12 h-12 object-cover border border-border" />
        ) : (
          <div className="w-12 h-12 flex items-center justify-center bg-bg-surface border border-border">
            <span className="font-mono text-[8px] text-text-secondary uppercase">
              {pf.file.name.split('.').pop()}
            </span>
          </div>
        )}
        <button
          onClick={() => removeFile(idx)}
          className="absolute -top-1 -right-1 w-4 h-4 bg-bg-surface border border-border text-[10px] flex items-center justify-center hover:bg-accent-red hover:text-white"
        >
          x
        </button>
      </div>
    ))}
    {pendingFiles.length >= 5 && (
      <span className="font-mono text-[8px] text-text-secondary">MAX</span>
    )}
  </div>
)}
```

- [ ] **Step 5: Update doSend to upload and include attachments**

```ts
async function doSend(finalText: string) {
  let attachments = undefined;
  if (pendingFiles.length > 0) {
    try {
      attachments = await uploadFiles();
    } catch {
      // toast error
      return;
    }
  }

  getSocket().emit('message:send', {
    ticketId: ticket.id,
    text: finalText || (attachments ? '' : undefined),
    whisper: whisperMode ? 1 : 0,
    replyToId: replyingTo?.id || undefined,
    attachments: attachments || undefined,
  });

  // Cleanup
  pendingFiles.forEach((pf) => { if (pf.preview) URL.revokeObjectURL(pf.preview); });
  setPendingFiles([]);
  setText('');
  // ... existing cleanup
}
```

- [ ] **Step 6: Update paste handler for multi-file awareness**

```ts
function handlePaste(e: React.ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file && pendingFiles.length < 5) {
        addFiles([file]);
      }
      return;
    }
  }
}
```

- [ ] **Step 7: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add client/src/components/chat/ComposeArea.tsx
git commit -m "feat(track-e): multi-file upload with preview bar in ComposeArea"
```

---

### Task 8: Verify

- [ ] **Step 1: Manual smoke test**

1. Click attach → file picker allows multiple selection
2. Select 3 images → preview bar shows 3 thumbnails with x buttons
3. Click x on one → removes it from the bar
4. Send → all files upload, message shows image grid
5. Attach a PDF + an image → preview bar shows image thumb + file extension label
6. Send → message shows image + document file card with download button
7. Try to attach 6 files → only first 5 accepted, "MAX" shown
8. Paste an image → adds to pending files
9. Drag-and-drop files onto chat → adds to pending files (if wired)
10. Verify old messages with `mediaUrl` still render correctly (backward compat)

- [ ] **Step 2: Run tests**

Run: `docker compose exec client npm test && docker compose exec server npm test`
Expected: All pass

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(track-e): complete multi-file upload with image grid and document cards"
```

---

## Summary

Track E delivers multi-file upload:
1. **Database:** `attachments` JSONB column
2. **Server:** `/uploads/multi` endpoint (multer array, 5 files max), extended MIME types, socket handler accepts attachments
3. **Client:** `AttachmentGrid` component (image grid + file cards), multi-file compose preview bar, legacy `mediaUrl` fallback
