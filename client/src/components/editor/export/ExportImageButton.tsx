import React from 'react';
import { Camera as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface ExportImageButtonProps {
  onClick: (e: React.MouseEvent) => void;
}

const ExportImageButton: React.FC<ExportImageButtonProps> = ({ onClick }) => {
  const { t } = useTranslation('components/common/buttons');

  return (
    <button
      onClick={onClick}
      className="p-1 bg-light-surface dark:bg-dark-surface rounded-md 
        hover:bg-light-hover dark:hover:bg-dark-hover transition-colors text-light-text dark:text-dark-text"
      title={t('exportButton.tooltip')}
    >
      <ImageIcon size={16} className="text-light-text dark:text-dark-text" />
    </button>
  );
};

export default ExportImageButton;
