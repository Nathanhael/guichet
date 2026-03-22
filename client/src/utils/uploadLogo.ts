import useStore from '../store/useStore';

export async function uploadLogo(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/v1/logos', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${useStore.getState().token}` },
    body: formData
  });
  const data = await res.json();
  if (data.url) return data.url;
  throw new Error(data.error || 'Upload failed');
}
