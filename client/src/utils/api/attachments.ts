export interface Attachment {
  id: number;
  snippet_id: number;
  file_name: string;
  mime: string;
  size: number;
  created_at: string;
}

const basePath = () => (window as any).__BASE_PATH__ || '';

async function checkOk(response: Response): Promise<Response> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Object.assign(new Error(error.error || 'Request failed'), { status: response.status });
  }
  return response;
}

export async function listAttachments(snippetId: string | number): Promise<Attachment[]> {
  const res = await checkOk(await fetch(`${basePath()}/api/snippets/${snippetId}/attachments`));
  return res.json();
}

export async function uploadAttachment(
  snippetId: string | number,
  file: File
): Promise<Attachment> {
  // Raw streaming upload — the worker pipes the body straight into R2
  const res = await checkOk(
    await fetch(`${basePath()}/api/snippets/${snippetId}/attachments`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
      },
      body: file,
    })
  );
  return res.json();
}

export async function deleteAttachment(
  snippetId: string | number,
  attachmentId: number
): Promise<void> {
  await checkOk(
    await fetch(`${basePath()}/api/snippets/${snippetId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    })
  );
}

export function attachmentDownloadUrl(snippetId: string | number, attachmentId: number): string {
  return `${basePath()}/api/snippets/${snippetId}/attachments/${attachmentId}`;
}
