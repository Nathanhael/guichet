import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useComposeAttachments } from '../useComposeAttachments';

const MB = 1024 * 1024;

function makeFile(name: string, sizeBytes: number, mime = 'image/png'): File {
  const file = new File(['x'], name, { type: mime });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

function mockFetch(response: Partial<Response> & { jsonValue?: unknown; ok?: boolean }) {
  const ok = response.ok ?? true;
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => response.jsonValue,
  } as Response);
}

describe('useComposeAttachments', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    URL.createObjectURL = vi.fn((obj: Blob | MediaSource) => {
      const url = `blob:mock-${createdUrls.length}`;
      createdUrls.push(url);
      void obj;
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('size-limit rejection', () => {
    it('rejects files larger than 10 MB and fires onError with code=file_too_large', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      const big = makeFile('big.png', 10 * MB + 1);
      act(() => {
        result.current.addFiles([big]);
      });

      expect(onError).toHaveBeenCalledWith({ code: 'file_too_large' });
      expect(result.current.pendingFiles).toHaveLength(0);
    });

    it('keeps files at exactly 10 MB', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      act(() => {
        result.current.addFiles([makeFile('ok.png', 10 * MB)]);
      });

      expect(onError).not.toHaveBeenCalled();
      expect(result.current.pendingFiles).toHaveLength(1);
    });

    it('fires onError once but still accepts the valid files in the same batch', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      const ok1 = makeFile('a.png', 1 * MB);
      const tooBig = makeFile('big.png', 20 * MB);
      const ok2 = makeFile('b.png', 2 * MB);

      act(() => {
        result.current.addFiles([ok1, tooBig, ok2]);
      });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith({ code: 'file_too_large' });
      expect(result.current.pendingFiles).toHaveLength(2);
      expect(result.current.pendingFiles.map((p) => p.file.name)).toEqual(['a.png', 'b.png']);
    });

    it('caps total pending files at 5', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      const files = Array.from({ length: 7 }, (_, i) => makeFile(`f${i}.png`, 1024));
      act(() => {
        result.current.addFiles(files);
      });

      expect(result.current.pendingFiles).toHaveLength(5);
    });
  });

  describe('paste-event parsing', () => {
    it('extracts image clipboard items, ignores non-images, and calls preventDefault', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      const imgFile = makeFile('pasted.png', 1024, 'image/png');
      const pastedItems = [
        { type: 'image/png', getAsFile: () => imgFile },
        { type: 'text/plain', getAsFile: () => null },
      ];
      const preventDefault = vi.fn();
      const pasteEvent = {
        clipboardData: { items: pastedItems },
        preventDefault,
      } as unknown as React.ClipboardEvent;

      act(() => {
        result.current.handlePaste(pasteEvent);
      });

      expect(preventDefault).toHaveBeenCalled();
      expect(result.current.pendingFiles).toHaveLength(1);
      expect(result.current.pendingFiles[0].file.name).toBe('pasted.png');
    });

    it('no-ops and does NOT call preventDefault when clipboard has no image items', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      const preventDefault = vi.fn();
      const pasteEvent = {
        clipboardData: {
          items: [{ type: 'text/plain', getAsFile: () => null }],
        },
        preventDefault,
      } as unknown as React.ClipboardEvent;

      act(() => {
        result.current.handlePaste(pasteEvent);
      });

      expect(preventDefault).not.toHaveBeenCalled();
      expect(result.current.pendingFiles).toHaveLength(0);
    });

    it('is safe when clipboardData is missing', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      const pasteEvent = {
        clipboardData: null,
        preventDefault: vi.fn(),
      } as unknown as React.ClipboardEvent;

      expect(() =>
        act(() => {
          result.current.handlePaste(pasteEvent);
        }),
      ).not.toThrow();
      expect(result.current.pendingFiles).toHaveLength(0);
    });
  });

  describe('multi-file upload sequencing', () => {
    it('POSTs multipart/form-data with all pending files and returns the parsed array', async () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      const serverResponse = [
        { url: '/u/1.png', name: 'a.png', mimeType: 'image/png', size: 10 },
        { url: '/u/2.png', name: 'b.png', mimeType: 'image/png', size: 20 },
      ];
      const fetchMock = mockFetch({ jsonValue: serverResponse });
      vi.stubGlobal('fetch', fetchMock);

      act(() => {
        result.current.addFiles([
          makeFile('a.png', 10, 'image/png'),
          makeFile('b.png', 20, 'image/png'),
        ]);
      });

      let returned: Awaited<ReturnType<typeof result.current.uploadFiles>> = [];
      await act(async () => {
        returned = await result.current.uploadFiles();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/v1/uploads/multi');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(init.body).toBeInstanceOf(FormData);
      const form = init.body as FormData;
      expect(form.getAll('files')).toHaveLength(2);

      expect(returned).toEqual(serverResponse);
    });

    it('flips `uploading` true during the request and false after success', async () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      let resolveFetch: (value: Response) => void = () => {};
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
      vi.stubGlobal('fetch', vi.fn(() => fetchPromise));

      act(() => {
        result.current.addFiles([makeFile('a.png', 10)]);
      });

      expect(result.current.uploading).toBe(false);

      let uploadPromise!: Promise<unknown>;
      act(() => {
        uploadPromise = result.current.uploadFiles();
      });

      expect(result.current.uploading).toBe(true);

      await act(async () => {
        resolveFetch({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
        await uploadPromise;
      });

      expect(result.current.uploading).toBe(false);
    });

    it('returns [] without fetching when pendingFiles is empty', async () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      let returned: unknown;
      await act(async () => {
        returned = await result.current.uploadFiles();
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(returned).toEqual([]);
    });

    it('fires onError with upload_failed when the server returns a non-ok response', async () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      vi.stubGlobal('fetch', mockFetch({ ok: false, jsonValue: { error: 'quota exceeded' } }));

      act(() => {
        result.current.addFiles([makeFile('a.png', 10)]);
      });

      let returned: unknown;
      await act(async () => {
        returned = await result.current.uploadFiles();
      });

      expect(returned).toEqual([]);
      expect(onError).toHaveBeenCalledWith({ code: 'upload_failed', detail: 'quota exceeded' });
      expect(result.current.uploading).toBe(false);
    });

    it('fires onError with upload_failed when fetch throws (network error)', async () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('network')),
      );

      act(() => {
        result.current.addFiles([makeFile('a.png', 10)]);
      });

      let returned: unknown;
      await act(async () => {
        returned = await result.current.uploadFiles();
      });

      expect(returned).toEqual([]);
      expect(onError).toHaveBeenCalledWith({ code: 'upload_failed' });
      expect(result.current.uploading).toBe(false);
    });
  });

  describe('removeFile / clearMedia', () => {
    it('removes the file at the given index and revokes its Object URL', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      act(() => {
        result.current.addFiles([
          makeFile('a.png', 10),
          makeFile('b.png', 10),
          makeFile('c.png', 10),
        ]);
      });
      const targetUrl = result.current.pendingFiles[1].preview;

      act(() => {
        result.current.removeFile(1);
      });

      expect(result.current.pendingFiles.map((p) => p.file.name)).toEqual(['a.png', 'c.png']);
      expect(revokedUrls).toContain(targetUrl);
    });

    it('clearMedia empties pendingFiles and revokes all Object URLs', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      act(() => {
        result.current.addFiles([makeFile('a.png', 10), makeFile('b.png', 10)]);
      });
      const urls = result.current.pendingFiles.map((p) => p.preview);

      act(() => {
        result.current.clearMedia();
      });

      expect(result.current.pendingFiles).toHaveLength(0);
      urls.forEach((u) => expect(revokedUrls).toContain(u));
    });
  });

  describe('drag handlers', () => {
    it('sets isDragOver on dragEnter, clears on drop, extracts files on drop', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      const preventDefault = vi.fn();
      const dragEnter = { preventDefault } as unknown as React.DragEvent;
      act(() => {
        result.current.dragProps.onDragEnter(dragEnter);
      });
      expect(result.current.isDragOver).toBe(true);
      expect(preventDefault).toHaveBeenCalled();

      const dropped = makeFile('dropped.png', 1024);
      const dropEvent = {
        preventDefault: vi.fn(),
        dataTransfer: { files: [dropped] },
      } as unknown as React.DragEvent;
      act(() => {
        result.current.dragProps.onDrop(dropEvent);
      });

      expect(result.current.isDragOver).toBe(false);
      expect(result.current.pendingFiles).toHaveLength(1);
      expect(result.current.pendingFiles[0].file.name).toBe('dropped.png');
    });

    it('onDragLeave only clears when leaving the outer container', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      act(() => {
        result.current.dragProps.onDragEnter({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });
      expect(result.current.isDragOver).toBe(true);

      const child = {} as Node;
      const container = { contains: (n: Node | null) => n === child } as unknown as HTMLElement;
      act(() => {
        result.current.dragProps.onDragLeave({
          currentTarget: container,
          relatedTarget: child,
        } as unknown as React.DragEvent);
      });
      expect(result.current.isDragOver).toBe(true);

      act(() => {
        result.current.dragProps.onDragLeave({
          currentTarget: container,
          relatedTarget: null,
        } as unknown as React.DragEvent);
      });
      expect(result.current.isDragOver).toBe(false);
    });
  });

  describe('handleFileChange', () => {
    it('adds selected files and resets the input value', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useComposeAttachments({ onError }));

      const input = document.createElement('input');
      input.type = 'file';
      Object.defineProperty(input, 'files', {
        value: [makeFile('picked.png', 1024)],
        configurable: true,
      });
      (result.current.fileInputRef as React.MutableRefObject<HTMLInputElement | null>).current = input;
      input.value = '';

      act(() => {
        result.current.handleFileChange({
          target: input,
        } as unknown as React.ChangeEvent<HTMLInputElement>);
      });

      expect(result.current.pendingFiles).toHaveLength(1);
      expect(input.value).toBe('');
    });
  });
});
