import { useLatest } from "../../../utils/hooks/useLatest";
import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import "./editDialog.css";

import { Trans } from "react-i18next";
import { useAppStore } from "../../../store/useAppStore";
import toast from "react-hot-toast";
import DatabaseService from "../../../utils/storage/databaseService";
import CoverUtil from "../../../utils/file/coverUtil";
import { isElectron } from "react-device-detect";
import { formatDateToDay } from "../../../utils/common";

export interface EditDialogState {
  isCheck: boolean;
  coverPreview: string;
  bookPath: string;
}

declare var window: any;

const EditDialog = () => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleEditDialog = useAppStore((s) => s.handleEditDialog);
  const handleActionDialog = useAppStore((s) => s.handleActionDialog);
  const handleRefreshBookCover = useAppStore((s) => s.handleRefreshBookCover);
  const { t } = useTranslation();
  const [state, setState] = useState<EditDialogState>(() => ({
    isCheck: false,
    coverPreview: "",
    bookPath: "",
  }));

  const nameRef = useRef<HTMLInputElement>(null);
  const authorRef = useRef<HTMLInputElement>(null);
  const publisherRef = useRef<HTMLInputElement>(null);
  const publishedRef = useRef<HTMLInputElement>(null);
  const modifiedRef = useRef<HTMLInputElement>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const languageRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const rightsRef = useRef<HTMLInputElement>(null);
  const isbnRef = useRef<HTMLInputElement>(null);
  const layoutRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const stateRef = useLatest(state);

  useEffect(() => {
    (async () => {
      if (nameRef.current) {
        nameRef.current.value = currentBook.name || "";
      }
      if (authorRef.current) {
        authorRef.current.value = currentBook.author || "";
      }
      if (publisherRef.current) {
        publisherRef.current.value = currentBook.publisher || "";
      }
      if (publishedRef.current) {
        publishedRef.current.value = formatDateToDay(
          currentBook.published
        );
      }
      if (modifiedRef.current) {
        modifiedRef.current.value = formatDateToDay(
          currentBook.modified
        );
      }
      if (identifierRef.current) {
        identifierRef.current.value = currentBook.identifier || "";
      }
      if (languageRef.current) {
        languageRef.current.value = currentBook.language || "";
      }
      if (subjectRef.current) {
        subjectRef.current.value = currentBook.subject || "";
      }
      if (rightsRef.current) {
        rightsRef.current.value = currentBook.rights || "";
      }
      if (isbnRef.current) {
        isbnRef.current.value = currentBook.isbn || "";
      }
      if (layoutRef.current) {
        layoutRef.current.value = currentBook.layout || "";
      }
      if (descriptionRef.current) {
        descriptionRef.current.value = currentBook.description || "";
      }
      const cover = await CoverUtil.getCover(currentBook);
      if (cover) {
        setState((prev) => ({ ...prev, coverPreview: cover }));
      }
      setState((prev) => ({
        ...prev,
        bookPath: currentBook.path || "",
      }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    handleEditDialog(false);
  };

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setState((prev) => ({ ...prev, coverPreview: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const handleSelectBookPath = async () => {
    if (!isElectron) return;
    const ipcRenderer = window.electronAPI;
    const filePath = await ipcRenderer.invoke("select-file");
    if (!filePath) return;
    setState((prev) => ({ ...prev, bookPath: filePath }));
  };

  const handleComfirm = async () => {
    const name = nameRef.current?.value || "";
    const author = authorRef.current?.value || "";
    const publisher = publisherRef.current?.value || "";
    const published = publishedRef.current?.value || "";
    const modified = modifiedRef.current?.value || "";
    const identifier = identifierRef.current?.value || "";
    const language = languageRef.current?.value || "";
    const subject = subjectRef.current?.value || "";
    const rights = rightsRef.current?.value || "";
    const isbn = isbnRef.current?.value || "";
    const layout = layoutRef.current?.value || "";
    const description = descriptionRef.current?.value || "";

    currentBook.name = name;
    currentBook.author = author;
    currentBook.publisher = publisher;
    currentBook.published = published;
    currentBook.modified = modified;
    currentBook.identifier = identifier;
    currentBook.language = language;
    currentBook.subject = subject;
    currentBook.rights = rights;
    currentBook.isbn = isbn;
    currentBook.layout = layout;
    currentBook.description = description;
    if (stateRef.current.bookPath) {
      currentBook.path = stateRef.current.bookPath;
    }

    // Handle cover update: if user picked a new image (base64 data URL)
    let { coverPreview } = stateRef.current;
    if (coverPreview && coverPreview.startsWith("data:")) {
      currentBook.cover = coverPreview;
      await CoverUtil.addCover(currentBook);
      handleRefreshBookCover(currentBook.key);
    }

    await DatabaseService.updateRecord(currentBook, "books");
    handleEditDialog(false);
    handleFetchBooks();
    toast.success(t("Edition successful"));
    handleActionDialog(false);
  };

  const { coverPreview } = state;
  return (
    <div className="edit-dialog-container">
      <div className="edit-dialog-title" style={{ position: "relative" }}>
        <Trans>Edit Book/Document</Trans>
      </div>

      <div className="edit-dialog-body">
        {/* Cover */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Cover</Trans>
          </span>
          <div
            className="edit-dialog-cover-box"
            onClick={() => coverInputRef.current?.click()}
            title={t("Click to select image")}
          >
            {coverPreview ? (
              <img
                src={coverPreview}
                alt="cover"
                className="edit-dialog-cover-img"
              />
            ) : (
              <span className="edit-dialog-cover-placeholder">
                <Trans>Click to select image</Trans>
              </span>
            )}
          </div>
          <input
            type="file"
            accept="image/*"
            ref={coverInputRef}
            style={{ display: "none" }}
            onChange={handleCoverSelect}
          />
        </div>

        {/* Book name */}
        <div className="edit-dialog-field">
          <div className="edit-dialog-input-row">
            <span className="edit-dialog-label">
              <Trans>Book/Document name</Trans>
            </span>
          </div>
          <input className="edit-dialog-input" ref={nameRef} />
        </div>

        {/* Author */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Author</Trans>
          </span>
          <input className="edit-dialog-input" ref={authorRef} />
        </div>

        {/* Publisher */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Publisher</Trans>
          </span>
          <input className="edit-dialog-input" ref={publisherRef} />
        </div>

        {/* Published date */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Published date</Trans>
          </span>
          <input className="edit-dialog-input" ref={publishedRef} />
        </div>

        {/* Modified date */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Modified date</Trans>
          </span>
          <input className="edit-dialog-input" ref={modifiedRef} />
        </div>

        {/* Identifier */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Identifier</Trans>
          </span>
          <input className="edit-dialog-input" ref={identifierRef} />
        </div>

        {/* Language */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Language</Trans>
          </span>
          <input className="edit-dialog-input" ref={languageRef} />
        </div>

        {/* Subject */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Subject</Trans>
          </span>
          <input className="edit-dialog-input" ref={subjectRef} />
        </div>

        {/* Rights */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Rights</Trans>
          </span>
          <input className="edit-dialog-input" ref={rightsRef} />
        </div>

        {/* ISBN */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>ISBN</Trans>
          </span>
          <input className="edit-dialog-input" ref={isbnRef} />
        </div>

        {/* Layout */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Layout</Trans>
          </span>
          <input className="edit-dialog-input" ref={layoutRef} />
        </div>

        {/* Description */}
        <div className="edit-dialog-field">
          <span className="edit-dialog-label">
            <Trans>Description</Trans>
          </span>
          <textarea
            className="edit-dialog-textarea"
            ref={descriptionRef}
            rows={3}
          />
        </div>

        {/* Book path */}
        {isElectron && (
          <div className="edit-dialog-field">
            <div className="edit-dialog-path-row">
              <span className="edit-dialog-label">
                <Trans>Book/Document path</Trans>
              </span>

              <div style={{ display: "flex", gap: "6px" }}>
                <span
                  className="change-location-button"
                  onClick={() => {
                    const ipcRenderer = window.electronAPI;
                    const fs = window.electronAPI.fs;
                    if (
                      !state.bookPath ||
                      !fs.existsSync(state.bookPath)
                    ) {
                      toast.error(t("Book/Document not exists"));
                      return;
                    }
                    ipcRenderer.invoke("open-explorer-folder", {
                      path: state.bookPath,
                      isFolder: false,
                    });
                  }}
                >
                  <Trans>Locate</Trans>
                </span>
                <span
                  className="change-location-button"
                  onClick={handleSelectBookPath}
                >
                  <Trans>Relink</Trans>
                </span>
              </div>
            </div>
            <div
              className="setting-dialog-location-title"
              style={{
                width: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                margin: "0px",
                boxSizing: "border-box",
                marginTop: "4px",
                marginBottom: "4px",
              }}
            >
              {state.bookPath || "-"}
            </div>
          </div>
        )}
      </div>

      <div className="edit-dialog-footer">
        <div
          className="add-dialog-cancel"
          onClick={() => {
            handleCancel();
          }}
        >
          <Trans>Cancel</Trans>
        </div>
        <div
          className="add-dialog-confirm"
          onClick={() => {
            handleComfirm();
          }}
        >
          <Trans>Confirm</Trans>
        </div>
      </div>
    </div>
  );
};

export default EditDialog;
