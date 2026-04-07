import React, { useState, useEffect, useMemo, useRef } from "react";
import "prismjs";
import "prismjs/components/prism-markup-templating.js";
import "prismjs/themes/prism.css";
import { Plus, Search, PanelLeftClose, PanelLeftOpen, ListFilter, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Switch } from "../../../components/common/switch/Switch";
import { CodeFragment, Snippet } from "../../../types/snippets";
import { detectLanguageFromFileName, getFileIcon, getFullFileName } from "../../../utils/language/languageUtils";
import CategoryList from "../../categories/CategoryList";
import CategorySuggestions from "../../categories/CategorySuggestions";
import FileUploadButton from "../../common/buttons/FileUploadButton";
import Modal from "../../common/modals/Modal";
import { FragmentEditor } from "./FragmentEditor";

export interface EditSnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (snippetData: Omit<Snippet, "id" | "updated_at">) => void;
  snippetToEdit: Snippet | null;
  showLineNumbers: boolean;
  allCategories: string[];
}

const EditSnippetModal: React.FC<EditSnippetModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  snippetToEdit,
  showLineNumbers,
  allCategories,
}) => {
  const { t } = useTranslation();
  const { t: translate } = useTranslation('components/snippets/edit');
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fragments, setFragments] = useState<CodeFragment[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryInput, setCategoryInput] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPublic, setIsPublic] = useState(snippetToEdit?.is_public || false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [activeFragmentIndex, setActiveFragmentIndex] = useState(0);

  // File Tree states
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [hiddenExtensions, setHiddenExtensions] = useState<Set<string>>(new Set());
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [editingFileIndex, setEditingFileIndex] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const extensionStats = useMemo(() => {
    const counts: Record<string, number> = {};
    let noExtCount = 0;
    fragments.forEach((f) => {
      const fullName = getFullFileName(f.file_name, f.language);
      if (fullName.includes('.')) {
        const ext = '.' + fullName.split('.').pop()?.toLowerCase();
        counts[ext] = (counts[ext] || 0) + 1;
      } else {
        noExtCount++;
      }
    });
    const result = Object.entries(counts).map(([ext, count]) => ({ ext, count })).sort((a, b) => a.ext.localeCompare(b.ext));
    if (noExtCount > 0) {
      result.push({ ext: '__no_ext__', count: noExtCount });
    }
    return result;
  }, [fragments]);

  const toggleExtension = (ext: string) => {
    setHiddenExtensions(prev => {
      const next = new Set(prev);
      if (next.has(ext)) {
        next.delete(ext);
      } else {
        next.add(ext);
      }
      return next;
    });
  };

  const filteredFragments = useMemo(() => {
    return fragments.filter((f) => {
      const fullName = getFullFileName(f.file_name, f.language).toLowerCase();
      const matchesSearch = !searchQuery.trim() || fullName.includes(searchQuery.toLowerCase());
      
      let ext = '__no_ext__';
      if (fullName.includes('.')) {
        ext = '.' + fullName.split('.').pop()?.toLowerCase();
      }
      const matchesExt = !hiddenExtensions.has(ext);
      return matchesSearch && matchesExt;
    });
  }, [fragments, searchQuery, hiddenExtensions]);

  useEffect(() => {
    if (editingFileIndex !== null && editInputRef.current) {
      editInputRef.current.focus();
      // Select the filename chunk without the extension
      const fileName = fragments[editingFileIndex]?.file_name || "";
      const dotIndex = fileName.lastIndexOf(".");
      if (dotIndex > 0) {
        editInputRef.current.setSelectionRange(0, dotIndex);
      } else {
        editInputRef.current.select();
      }
    }
  }, [editingFileIndex]);

  const handleFileNameChange = (index: number, newName: string) => {
    setFragments((current) => {
      const newFragments = [...current];
      newFragments[index] = { ...newFragments[index], file_name: newName };

      const detectedLanguage = detectLanguageFromFileName(newName);
      if (detectedLanguage) {
        newFragments[index].language = detectedLanguage;
      }

      return newFragments;
    });
    setHasUnsavedChanges(true);
  };

  const handleFileNameKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === "Enter") {
      setEditingFileIndex(null);
    } else if (e.key === "Escape") {
      setEditingFileIndex(null);
    }
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setFragments([
      {
        file_name: "main",
        code: "",
        language: "",
        position: 0,
      },
    ]);
    setCategories([]);
    setError("");
    setCategoryInput("");
    setHasUnsavedChanges(false);
  };

  useEffect(() => {
    if (isOpen) {
      if (snippetToEdit) {
        setTitle(snippetToEdit.title?.slice(0, 255) || "");
        setDescription(snippetToEdit.description || "");
        setFragments(JSON.parse(JSON.stringify(snippetToEdit.fragments || [])));
        setCategories(snippetToEdit.categories || []);
        setIsPublic(snippetToEdit.is_public || false);
      } else {
        resetForm();
      }
    }
  }, [isOpen, snippetToEdit]);

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  const handleCategorySelect = (category: string) => {
    const normalizedCategory = category.toLowerCase().trim();
    if (
      normalizedCategory &&
      categories.length < 20 &&
      !categories.includes(normalizedCategory)
    ) {
      setCategories((prev) => [...prev, normalizedCategory]);
      setHasUnsavedChanges(true);
    }
    setCategoryInput("");
  };

  const handleRemoveCategory = (e: React.MouseEvent, category: string) => {
    e.preventDefault();
    setCategories((cats) => cats.filter((c) => c !== category));
    setHasUnsavedChanges(true);
  };

  const handleAddFragment = () => {
    setFragments((current) => {
      const newFragments = [
        ...current,
        {
          file_name: `file${current.length + 1}`,
          code: "",
          language: "",
          position: current.length,
        },
      ];
      setActiveFragmentIndex(newFragments.length - 1);
      setEditingFileIndex(newFragments.length - 1); // Edit inline directly
      return newFragments;
    });
    setHasUnsavedChanges(true);
  };

  const handleFileUpload = (fileData: {
    file_name: string;
    code: string;
    language: string;
    position: number;
  }) => {
    setFragments((current) => {
      const newFragments = [
        ...current,
        {
          ...fileData,
          position: current.length,
        },
      ];
      setActiveFragmentIndex(newFragments.length - 1);
      return newFragments;
    });
    setHasUnsavedChanges(true);
  };

  const handleUploadError = (error: string) => {
    setError(error);
    // Clear error after 5 seconds
    setTimeout(() => {
      setError("");
    }, 5000);
  };

  const handleUpdateFragment = (
    index: number,
    updatedFragment: CodeFragment
  ) => {
    setFragments((current) => {
      const newFragments = [...current];
      newFragments[index] = updatedFragment;
      return newFragments;
    });
    setHasUnsavedChanges(true);
  };

  const handleDeleteFragment = (index: number) => {
    if (fragments.length > 1) {
      setFragments((current) => current.filter((_, i) => i !== index));
      if (activeFragmentIndex === index) {
        setActiveFragmentIndex(Math.max(0, index - 1));
      } else if (activeFragmentIndex > index) {
        setActiveFragmentIndex(activeFragmentIndex - 1);
      }
      setHasUnsavedChanges(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (fragments.length === 0) {
      setError(translate('editSnippetModal.fragmentRequired'));
      return;
    }

    if (fragments.some((f) => !f.file_name.trim())) {
      setError(translate('editSnippetModal.mustHaveFileNames'));
      return;
    }

    setIsSubmitting(true);
    const snippetData = {
      title: title.slice(0, 255),
      description: description,
      fragments: fragments.map((f, idx) => ({ ...f, position: idx })),
      categories: categories,
      is_public: isPublic ? 1 : 0,
      is_pinned: snippetToEdit?.is_pinned || 0,
      is_favorite: snippetToEdit?.is_favorite || 0,
    };

    try {
      await onSubmit(snippetData);
      setHasUnsavedChanges(false);
      onClose();
    } catch (error) {
      setError(translate('editSnippetModal.error.savingFailed'));
      console.error("Error saving snippet:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModalClose = () => {
    if (hasUnsavedChanges) {
      const confirmClose = window.confirm(
        translate('editSnippetModal.unsavedChanges')
      );
      if (!confirmClose) return;
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleModalClose}
      expandable={true}
      title={
        <h2 className="text-xl font-bold text-light-text dark:text-dark-text">
          {
            snippetToEdit
              ? translate('editSnippetModal.editSnippet')
              : translate('editSnippetModal.addSnippet')
          }
        </h2>
      }
    >
      <style>
        {`
          /* Force the modal to use full height when possible */
          .modal-content-wrapper {
             max-height: 85vh;
             display: flex;
             flex-direction: column;
          }
          .modal-footer {
            position: sticky;
            background: var(--footer-bg);
            border-top: 1px solid var(--footer-border);
            margin-top: 1rem;
            z-index: 100;
          }

          .modal-footer::before {
            content: '';
            position: absolute;
            bottom: 100%;
            left: 0;
            right: 0;
            height: 20px;
            background: linear-gradient(to top, var(--footer-bg), transparent);
            pointer-events: none;
          }

          .add-fragment-button {
            transition: all 0.2s ease-in-out;
          }

          .add-fragment-button:hover {
            transform: translateY(-1px);
          }

          :root {
            --footer-bg: var(--light-surface);
            --footer-border: var(--light-border);
          }

          .dark {
            --footer-bg: var(--dark-surface);
            --footer-border: var(--dark-border);
          }
        `}
      </style>
      <div className="relative flex flex-col h-full max-h-full isolate">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          <div className="flex-none">
            {error && (
              <p className="mb-4 text-red-500 dark:text-red-400">{error}</p>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="pr-2 space-y-4">
              {/* Title input */}
              <div>
                <label
                  htmlFor="title"
                  className="block text-sm font-medium text-light-text dark:text-dark-text"
                >
                  {translate('editSnippetModal.form.title.label')}
                </label>
                <input
                  type="text"
                  id="title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value.slice(0, 100));
                    setHasUnsavedChanges(true);
                  }}
                  className="block w-full p-2 mt-1 text-sm border rounded-md bg-light-surface dark:bg-dark-surface text-light-text dark:text-dark-text border-light-border dark:border-dark-border focus:ring-2 focus:ring-light-primary dark:focus:ring-dark-primary focus:border-light-primary dark:focus:border-dark-primary"
                  required
                  placeholder={translate('editSnippetModal.form.title.placeholder', { max: 100 })}
                  maxLength={100}
                />
                <p className="mt-1 text-sm text-light-text-secondary dark:text-dark-text-secondary">
                  {translate('editSnippetModal.form.title.counter', { characters: title.length, max: 100 })}
                </p>
              </div>

              {/* Description input */}
              <div>
                <label
                  htmlFor="description"
                  className="block text-sm font-medium text-light-text dark:text-dark-text"
                >
                  {translate('editSnippetModal.form.description.label')}
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setHasUnsavedChanges(true);
                  }}
                  className="block w-full p-2 mt-1 text-sm border rounded-md bg-light-surface dark:bg-dark-surface text-light-text dark:text-dark-text border-light-border dark:border-dark-border focus:ring-2 focus:ring-light-primary dark:focus:ring-dark-primary focus:border-light-primary dark:focus:border-dark-primary"
                  rows={3}
                  placeholder={translate('editSnippetModal.form.description.placeholder', { max: 20 })}
                />
              </div>

              {/* Categories section */}
              <div>
                <label
                  htmlFor="categories"
                  className="block text-sm font-medium text-light-text dark:text-dark-text"
                >
                  {translate('editSnippetModal.form.categories.label', { max: 20 })}
                </label>
                <CategorySuggestions
                  inputValue={categoryInput}
                  onInputChange={setCategoryInput}
                  onCategorySelect={handleCategorySelect}
                  existingCategories={allCategories}
                  selectedCategories={categories}
                  placeholder={translate('editSnippetModal.form.categories.placeholder')}
                  maxCategories={20}
                  showAddText={true}
                  handleHashtag={false}
                  className="block w-full p-2 mt-1 text-sm border rounded-md bg-light-surface dark:bg-dark-surface text-light-text dark:text-dark-text border-light-border dark:border-dark-border focus:ring-2 focus:ring-light-primary dark:focus:ring-dark-primary focus:border-light-primary dark:focus:border-dark-primary"
                />
                <p className="mt-1 text-sm text-light-text-secondary dark:text-dark-text-secondary">
                  {translate('editSnippetModal.form.categories.counter', { categories: categories.length, max: 20 })}
                </p>
                <CategoryList
                  categories={categories}
                  onCategoryClick={handleRemoveCategory}
                  className="mt-2"
                  variant="removable"
                />
              </div>

              {/* Public snippet section */}
              <div className="space-y-1">
                <label className="flex items-center gap-2">
                  <Switch
                    id="isPublic"
                    checked={!!isPublic}
                    onChange={(checked) => {
                      setIsPublic(checked);
                      setHasUnsavedChanges(true);
                    }}
                  />
                  <span className="text-sm font-medium text-light-text dark:text-dark-text">
                    {translate('editSnippetModal.form.isPublic.label')}
                  </span>
                </label>
                <p className="text-sm text-light-text-secondary dark:text-dark-text-secondary">
                  {translate('editSnippetModal.form.isPublic.description')}
                </p>
              </div>

              {/* Code Fragments section */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-sm font-medium text-light-text dark:text-dark-text">
                    {translate('editSnippetModal.form.codeFragments.label', { fragments: fragments.length })}
                  </label>
                  <FileUploadButton
                    onFileProcessed={handleFileUpload}
                    onError={handleUploadError}
                    existingFragments={fragments}
                    className="text-xs"
                  />
                </div>

                <div className="flex flex-col md:flex-row border border-light-border dark:border-dark-border rounded-lg overflow-hidden bg-light-surface dark:bg-dark-surface shadow-sm h-[500px]">
                  {/* Sidebar (File Tree) */}
                  {isSidebarOpen && (
                    <div className="w-full md:w-56 xl:w-64 shrink-0 border-b md:border-b-0 md:border-r border-light-border dark:border-dark-border flex flex-col bg-light-bg/50 dark:bg-dark-bg/50 transition-all duration-300">
                      <div className="px-3 py-2 border-b border-light-border dark:border-dark-border flex flex-col gap-2 bg-light-hover/30 dark:bg-dark-hover/30">
                        <div className="flex items-center justify-between text-xs font-semibold text-light-text-secondary dark:text-dark-text-secondary">
                          <span>{translate('editSnippetModal.form.codeFragments.label', { fragments: fragments.length })}</span>
                          <button 
                            type="button"
                            onClick={() => setIsSidebarOpen(false)}
                            className="p-1 hover:bg-light-hover dark:hover:bg-dark-hover rounded transition-colors"
                          >
                            <PanelLeftClose size={14} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-light-text-secondary dark:text-dark-text-secondary" />
                            <input 
                              type="text" 
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder={translate('searchFiles')}
                              className="w-full pl-6 pr-2 py-1 text-xs bg-light-surface dark:bg-dark-surface border border-light-border dark:border-dark-border rounded focus:outline-none focus:border-light-primary dark:focus:border-dark-primary text-light-text dark:text-dark-text placeholder-light-text-secondary/50 dark:placeholder-dark-text-secondary/50"
                            />
                          </div>
                          {extensionStats.length > 0 && (
                            <div className="relative shrink-0" ref={filterRef}>
                              <button
                                type="button"
                                onClick={() => setIsFilterOpen(!isFilterOpen)}
                                className={`p-1 rounded border border-light-border dark:border-dark-border hover:bg-light-hover dark:hover:bg-dark-hover transition-colors flex items-center justify-center h-[26px] w-[26px] ${isFilterOpen ? 'bg-light-hover dark:bg-dark-hover' : 'bg-light-surface dark:bg-dark-surface'}`}
                                title={translate('filterFiles')}
                              >
                                <ListFilter size={14} className="text-light-text-secondary dark:text-dark-text-secondary" />
                              </button>

                              {isFilterOpen && (
                                <div className="absolute left-0 left-auto md:left-full md:ml-1 md:-mt-8 right-0 md:right-auto top-full mt-1 w-56 bg-light-surface dark:bg-dark-surface border border-light-border dark:border-dark-border rounded-lg shadow-xl z-50 py-2 flex flex-col">
                                  <div className="px-3 pb-2 text-xs font-semibold text-light-text-secondary dark:text-dark-text-secondary border-b border-light-border dark:border-dark-border mb-1">
                                    {translate('fileExtensions')}
                                  </div>
                                  <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                    {extensionStats.map(({ ext, count }) => {
                                      const checked = !hiddenExtensions.has(ext);
                                      return (
                                        <button
                                          type="button"
                                          key={ext}
                                          onClick={() => toggleExtension(ext)}
                                          className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-light-hover dark:hover:bg-dark-hover text-sm text-light-text dark:text-dark-text transition-colors group"
                                        >
                                          <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 flex items-center justify-center shrink-0">
                                              <Check size={14} className={`transition-opacity ${checked ? 'opacity-100 text-light-primary dark:text-dark-primary' : 'opacity-0'}`} />
                                            </div>
                                            <span className="truncate max-w-[130px] text-left">{ext === '__no_ext__' ? translate('noExtension') : ext}</span>
                                          </div>
                                          <span className="text-xs bg-light-bg dark:bg-dark-bg px-1.5 py-0.5 rounded-full text-light-text-secondary dark:text-dark-text-secondary group-hover:bg-light-surface dark:group-hover:bg-dark-surface">
                                            {count}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto max-h-[500px]">
                        {filteredFragments.map((fragment) => {
                          const fullName = getFullFileName(fragment.file_name, fragment.language);
                          const originalIndex = fragments.findIndex(f => f.position === fragment.position && f.file_name === fragment.file_name && f.code === fragment.code);
                          const displayIndex = originalIndex >= 0 ? originalIndex : fragments.indexOf(fragment);
                          const isActive = activeFragmentIndex === displayIndex;
                          const isEditing = editingFileIndex === displayIndex;

                          return (
                            <div 
                              key={displayIndex} 
                              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors border-l-2 ${
                                isActive
                                  ? "bg-light-hover dark:bg-dark-hover text-light-text dark:text-dark-text border-light-primary dark:border-dark-primary"
                                  : "border-transparent text-light-text-secondary dark:text-dark-text-secondary hover:bg-light-hover/50 dark:hover:bg-dark-hover/50"
                              }`}
                            >
                              <div className="shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                                {getFileIcon(fragment.file_name, fragment.language, "w-full h-full text-light-text-secondary dark:text-dark-text-secondary")}
                              </div>
                              {isEditing ? (
                                <input
                                  ref={editInputRef}
                                  type="text"
                                  value={fullName}
                                  onChange={(e) => handleFileNameChange(displayIndex, e.target.value)}
                                  onBlur={() => setEditingFileIndex(null)}
                                  onKeyDown={(e) => handleFileNameKeyDown(e)}
                                  className="w-full bg-light-surface dark:bg-dark-surface border border-light-primary dark:border-dark-primary rounded px-1 text-sm text-light-text dark:text-dark-text outline-none"
                                />
                              ) : (
                                <div 
                                  className="truncate flex-1 cursor-pointer select-none"
                                  onClick={() => setActiveFragmentIndex(displayIndex)}
                                  onDoubleClick={() => setEditingFileIndex(displayIndex)}
                                >
                                  {fullName || '...'}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {filteredFragments.length === 0 && (
                          <div className="px-3 py-4 text-xs text-center text-light-text-secondary dark:text-dark-text-secondary">
                            {translate('noFilesFound')}
                          </div>
                        )}
                      </div>
                      <div className="p-2 border-t border-light-border dark:border-dark-border bg-light-surface dark:bg-dark-surface">
                        <button 
                          type="button" 
                          onClick={handleAddFragment} 
                          className="w-full flex items-center justify-center gap-1 p-1.5 text-xs font-semibold rounded bg-light-primary/10 dark:bg-dark-primary/10 text-light-primary dark:text-dark-primary hover:bg-light-primary/20 dark:hover:bg-dark-primary/20 transition-colors"
                        >
                          <Plus size={14}/> {translate('editSnippetModal.form.codeFragments.add')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Main Editor */}
                  <div className="flex-1 min-w-0 flex flex-col bg-light-bg dark:bg-dark-bg overflow-y-auto relative">
                    {!isSidebarOpen && (
                      <button
                        type="button"
                        onClick={() => setIsSidebarOpen(true)}
                        className="absolute top-2.5 left-2.5 z-10 p-1.5 bg-light-surface dark:bg-dark-surface border border-light-border dark:border-dark-border hover:bg-light-hover dark:hover:bg-dark-hover rounded transition-colors text-light-text-secondary dark:text-dark-text-secondary flex items-center justify-center shadow-sm"
                        title={translate('expandSidebar')}
                      >
                        <PanelLeftOpen size={16} />
                      </button>
                    )}
                    {(() => {
                      const activeIndex = activeFragmentIndex >= fragments.length ? 0 : activeFragmentIndex;
                      const activeFragment = fragments[activeIndex];
                      if (!activeFragment) return null;
                      
                      return (
                        <FragmentEditor
                          key={`editor-${activeIndex}`}
                          fragment={activeFragment}
                          onUpdate={(updated) => handleUpdateFragment(activeIndex, updated)}
                          onDelete={() => handleDeleteFragment(activeIndex)}
                          showLineNumbers={showLineNumbers}
                        />
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          {/* Added more specificity to footer background to avoid visible background elements in edit/create snippet mode. */}
          <div className="!bg-light-surface dark:!bg-dark-surface modal-footer -bottom-5 inset-x-0 mt-4 z-10">
            <div className="flex justify-end gap-2 py-4">
              <button
                type="button"
                onClick={handleModalClose}
                className="px-4 py-2 text-sm border rounded-md bg-light-surface dark:bg-dark-surface text-light-text dark:text-dark-text hover:bg-light-hover dark:hover:bg-dark-hover border-light-border dark:border-dark-border"
              >
                {t('action.cancel')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm text-white rounded-md bg-light-primary dark:bg-dark-primary hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isSubmitting}
              >
                {
                  isSubmitting
                    ? t('action.saving')
                    : snippetToEdit
                      ? t('action.save')
                      : t('action.addSnippet')
                }
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
};

export default EditSnippetModal;
