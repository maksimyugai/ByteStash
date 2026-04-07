import React, { useRef, useState } from 'react';
import Modal from '../../common/modals/Modal';
import { CarbonExportPreview } from './CarbonExportPreview';
import { useTranslation } from 'react-i18next';
import { toPng, toSvg } from 'html-to-image';
import { Download, Copy, Share2, Linkedin } from 'lucide-react';

export interface ExportImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  language: string;
}

const ExportImageModal: React.FC<ExportImageModalProps> = ({
  isOpen,
  onClose,
  code,
  language,
}) => {
  const { t } = useTranslation('components/common/buttons');
  const previewRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState('');

  const handleDownloadPng = async () => {
    if (!previewRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl = await toPng(previewRef.current, { pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `carbon-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to generate PNG', err);
      alert(t('exportModal.errorGenerate'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadSvg = async () => {
    if (!previewRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl = await toSvg(previewRef.current);
      const link = document.createElement('a');
      link.download = `carbon-${Date.now()}.svg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to generate SVG', err);
      alert(t('exportModal.errorGenerate'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyClipboard = async () => {
    if (!previewRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl = await toPng(previewRef.current, { pixelRatio: 2 });
      // Convert base64 to blob
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      
      setCopiedMessage(t('exportModal.successCopy'));
      setTimeout(() => setCopiedMessage(''), 3000);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
      alert(t('exportModal.errorCopy'));
    } finally {
      setIsExporting(false);
    }
  };

  const getTwitterShareUrl = () => {
    const text = encodeURIComponent('Check out this code snippet!');
    return `https://twitter.com/intent/tweet?text=${text}`;
  };

  const getLinkedInShareUrl = () => {
    // LinkedIn doesn't support pre-filling images via URL intent well,
    // but users can copy to clipboard and paste in the post intent.
    return `https://www.linkedin.com/sharing/share-offsite/`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('exportModal.title')}
      width="max-w-5xl"
    >
      <div className="flex flex-col gap-6">
        
        {/* Preview Area */}
        <div className="flex justify-center bg-light-background dark:bg-dark-background rounded-lg border border-light-border dark:border-dark-border overflow-x-auto p-4 max-h-[500px]">
          <div className="transform scale-75 origin-top relative" style={{ height: 'max-content' }}>
            <CarbonExportPreview
              ref={previewRef}
              code={code}
              language={language}
              showLineNumbers={true}
            />
          </div>
        </div>

        {/* Actions Area */}
        <div className="flex flex-col gap-4 border-t border-light-border dark:border-dark-border pt-4">
          <div className="flex flex-wrap justify-between items-center gap-4">
            
            <div className="flex gap-3">
              <button
                disabled={isExporting}
                onClick={handleDownloadPng}
                className="flex items-center gap-2 px-4 py-2 bg-light-primary dark:bg-dark-primary text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Download size={16} />
                {t('exportModal.downloadPng')}
              </button>
              
              <button
                disabled={isExporting}
                onClick={handleDownloadSvg}
                className="flex items-center gap-2 px-4 py-2 border border-light-border dark:border-dark-border rounded-md hover:bg-light-surface dark:hover:bg-dark-surface transition-colors disabled:opacity-50 text-light-text dark:text-dark-text"
              >
                <Download size={16} />
                {t('exportModal.downloadSvg')}
              </button>

              <button
                disabled={isExporting}
                onClick={handleCopyClipboard}
                className="flex items-center gap-2 px-4 py-2 border border-light-border dark:border-dark-border rounded-md hover:bg-light-surface dark:hover:bg-dark-surface transition-colors disabled:opacity-50 text-light-text dark:text-dark-text"
              >
                <Copy size={16} />
                {t('exportModal.copyClipboard')}
              </button>

              {copiedMessage && (
                <span className="text-sm text-green-500 self-center">{copiedMessage}</span>
              )}
            </div>

            <div className="flex gap-3">
              <a
                href={getTwitterShareUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 bg-[#1DA1F2] text-white rounded-md hover:opacity-90 transition-opacity"
              >
                <Share2 size={16} />
                {t('exportModal.shareTwitter')}
              </a>
              <a
                href={getLinkedInShareUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 bg-[#0A66C2] text-white rounded-md hover:opacity-90 transition-opacity"
              >
                <Linkedin size={16} />
                {t('exportModal.shareLinkedIn')}
              </a>
            </div>

          </div>
        </div>

      </div>
    </Modal>
  );
};

export default ExportImageModal;
