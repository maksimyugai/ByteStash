import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import {
  Attachment,
  attachmentDownloadUrl,
  deleteAttachment,
  listAttachments,
  uploadAttachment,
} from '../../../utils/api/attachments';
import { useToast } from '../../../hooks/useToast';

interface SnippetAttachmentsProps {
  snippetId: string | number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** File attachments stored in R2, shown under the snippet code in the owner view. */
export const SnippetAttachments: React.FC<SnippetAttachmentsProps> = ({ snippetId }) => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    listAttachments(snippetId)
      .then((list) => {
        if (!cancelled) setAttachments(list);
      })
      .catch(() => {
        /* attachments are non-critical; ignore load errors */
      });
    return () => {
      cancelled = true;
    };
  }, [snippetId]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsUploading(true);
    try {
      const created = await uploadAttachment(snippetId, file);
      setAttachments((prev) => [created, ...prev]);
    } catch (error: any) {
      addToast(error?.message || 'Failed to upload attachment', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (attachment: Attachment) => {
    try {
      await deleteAttachment(snippetId, attachment.id);
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
    } catch (error: any) {
      addToast(error?.message || 'Failed to delete attachment', 'error');
    }
  };

  return (
    <div className="mt-4 border-t border-light-border dark:border-dark-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-light-text-secondary dark:text-dark-text-secondary">
          <Paperclip size={14} />
          Attachments
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md bg-light-surface dark:bg-dark-surface
            hover:bg-light-hover dark:hover:bg-dark-hover text-light-text dark:text-dark-text transition-colors
            disabled:opacity-50"
        >
          {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Upload
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
      </div>

      {attachments.length === 0 ? (
        <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary">
          No attachments
        </p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md
                bg-light-surface dark:bg-dark-surface text-sm text-light-text dark:text-dark-text"
            >
              <span className="truncate" title={attachment.file_name}>
                {attachment.file_name}
                <span className="ml-2 text-xs text-light-text-secondary dark:text-dark-text-secondary">
                  {formatSize(attachment.size)}
                </span>
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <a
                  href={attachmentDownloadUrl(snippetId, attachment.id)}
                  download={attachment.file_name}
                  className="p-1 rounded hover:bg-light-hover dark:hover:bg-dark-hover"
                  title="Download"
                >
                  <Download size={14} />
                </a>
                <button
                  onClick={() => handleDelete(attachment)}
                  className="p-1 rounded hover:bg-light-hover dark:hover:bg-dark-hover text-red-500"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
