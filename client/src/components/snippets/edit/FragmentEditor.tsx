import React from "react";
import {
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CodeFragment } from "../../../types/snippets";
import { getLanguageLabel, getFullFileName } from "../../../utils/language/languageUtils";
import { IconButton } from "../../common/buttons/IconButton";
import { CodeEditor } from "../../editor/CodeEditor";

interface FragmentEditorProps {
  fragment: CodeFragment;
  onUpdate: (fragment: CodeFragment) => void;
  onDelete: () => void;
  showLineNumbers: boolean;
}

export const FragmentEditor: React.FC<FragmentEditorProps> = ({
  fragment,
  onUpdate,
  onDelete,
  showLineNumbers,
}) => {
  const { t: translate } = useTranslation('components/snippets/edit');

  const handleCodeChange = (newCode: string | undefined) => {
    onUpdate({
      ...fragment,
      code: newCode || "",
    });
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center gap-2 p-3 bg-light-hover dark:bg-dark-hover border-b border-light-border dark:border-dark-border shrink-0">
        <div className="flex items-center gap-0.5">
          {/* Sorting delegated to Sidebar */}
        </div>        <div className="flex items-center flex-1 min-w-0 pr-4 pl-1">
           <span className="truncate font-medium text-sm text-light-text dark:text-dark-text mr-4">
             {getFullFileName(fragment.file_name, fragment.language) || translate('fragmentEditor.form.fileName.placeholder')}
           </span>
           {fragment.language && (
             <span className="bg-light-primary/10 dark:bg-dark-primary/10 text-light-primary dark:text-dark-primary text-xs font-semibold px-2 py-0.5 rounded ml-auto tracking-wide uppercase">
               {getLanguageLabel(fragment.language)}
             </span>
           )}
        </div>

        <div className="flex items-center gap-1">
          <IconButton
            icon={<Trash2 size={16} className="hover:text-red-500" />}
            onClick={onDelete}
            variant="custom"
            size="sm"
            className="w-9 h-9 bg-light-hover dark:bg-dark-hover hover:bg-light-surface dark:hover:bg-dark-surface"
            label={translate('fragmentEditor.action.delete')}
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-3 bg-light-surface dark:bg-dark-surface">
        <div className="h-full overflow-y-auto pr-1">
          <CodeEditor
            code={fragment.code}
            language={fragment.language}
            onValueChange={handleCodeChange}
            showLineNumbers={showLineNumbers}
          />
        </div>
      </div>
    </div>
  );
};
