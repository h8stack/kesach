import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Trans } from "react-i18next";
import {
  clearAllData,
  getStorageLocation,
  reloadManager,
  vexComfirmAsync,
  vexPromptAsync,
} from "../../../utils/common";

import toast from "react-hot-toast";
import { isElectron } from "react-device-detect";
import { LocalFileManager } from "../../../utils/file/localFile";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { changeLibrary, changePath } from "../../../utils/file/common";
import { getSnapshots } from "../../../utils/file/backup";
import { restoreFromSnapshot } from "../../../utils/file/restore";
import {
  exportBooks,
  exportDictionaryHistory,
  exportHighlights,
  exportNotes,
} from "../../../utils/file/export";
import { importNotesData } from "../../../utils/file/importData";
import DatabaseService from "../../../utils/storage/databaseService";
import { useAppStore } from "../../../store/useAppStore";

export interface SettingInfoState {
  storageLocation: string;
  snapshotList: { file: string; time: number }[];
  ttsCacheSize: string;
  tempCacheSize: string;
  allDataSize: string;
  exportNotesFormat: string;
  exportHighlightsFormat: string;
  exportWordsFormat: string;
  [key: string]: any;
}

declare var window: any;
const DataSetting = () => {
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setStateObj] = useState<SettingInfoState>(() => ({
    storageLocation: getStorageLocation() || "",
    snapshotList: [],
    ttsCacheSize: "",
    tempCacheSize: "",
    allDataSize: "",
    exportNotesFormat: "",
    exportHighlightsFormat: "",
    exportWordsFormat: "",
  }));
  const stateRef = useRef<SettingInfoState>(state);
  const setState = (
    patch:
      | Partial<SettingInfoState>
      | ((prev: SettingInfoState) => Partial<SettingInfoState>)
  ) => {
    const prev = stateRef.current;
    const partial =
      typeof patch === "function"
        ? (patch as (prev: SettingInfoState) => Partial<SettingInfoState>)(prev)
        : patch;
    const next = { ...prev, ...partial };
    stateRef.current = next;
    setStateObj(next);
  };

  useEffect(() => {
    const init = async () => {
      if (!isElectron) {
        const status = await LocalFileManager.getPermissionStatus();
        setState({
          storageLocation: status.directoryName || "",
          snapshotList: [],
        });
      }
      if (isElectron) {
        setState({
          snapshotList: getSnapshots(),
        });
        loadCacheSizes();
      }
    };
    init();
  }, []);
  const getCacheSizeLabel = (bytes: number): string => {
    if (!bytes || bytes <= 0) {
      return "0 MB";
    }
    const megaBytes = bytes / 1024 / 1024;
    if (megaBytes >= 1024) {
      return (megaBytes / 1024).toFixed(2) + " GB";
    }
    return megaBytes.toFixed(1) + " MB";
  };
  const loadCacheSizes = async () => {
    if (!isElectron || !window.electronAPI) {
      return;
    }
    try {
      const ttsSize = await window.electronAPI.invoke("get-cache-size", {
        type: "tts",
      });
      const tempSize = await window.electronAPI.invoke("get-cache-size", {
        type: "temp",
      });
      const allSize = await window.electronAPI.invoke("get-cache-size", {
        type: "all",
        storagePath: getStorageLocation(),
      });
      setState({
        ttsCacheSize: getCacheSizeLabel(ttsSize),
        tempCacheSize: getCacheSizeLabel(tempSize),
        allDataSize: getCacheSizeLabel(allSize),
      });
    } catch (error) {
      console.error("Error loading cache sizes:", error);
    }
  };
  const handleClearTTSCache = async () => {
    try {
      await window.electronAPI.invoke("clear-tts", {});
      toast.success(t("Clear successful"));
    } catch (error) {
      toast.error(t("Clear failed"));
    }
    loadCacheSizes();
  };
  const handleClearTempCache = async () => {
    try {
      await window.electronAPI.invoke("clear-temp-cache", {});
      toast.success(t("Clear successful"));
    } catch (error) {
      toast.error(t("Clear failed"));
    }
    loadCacheSizes();
  };
  const handleChangeLocation = async () => {
    const ipcRenderer = window.electronAPI;
    const newPath = await ipcRenderer.invoke("select-path");
    if (!newPath) {
      return;
    }
    let isSuccess = await changePath(newPath);
    if (!isSuccess) {
      toast.error(t("Change failed"));
      return;
    }
    ConfigService.setItem("storageLocation", newPath);
    setState({ storageLocation: newPath });

    toast.success(t("Change successful"));
    handleFetchBooks();
  };
  const handleSwitchLibrary = async () => {
    if (isElectron) {
      const ipcRenderer = window.electronAPI;
      const newPath = await ipcRenderer.invoke("select-path");
      if (!newPath) {
        return;
      }
      let isSuccess = await changeLibrary(newPath);
      if (!isSuccess) {
        toast.error(t("Switch failed"));
        return;
      }
      ConfigService.setItem("storageLocation", newPath);
      setState({ storageLocation: newPath });
      try {
        let fs = window.electronAPI.fs;
        let text = fs.readFileSync(
          window.electronAPI.path.join(newPath, "config", "config.json"),
          "utf-8"
        );
        let config = JSON.parse(text);
        for (let key in config) {
          ConfigService.setItem(key, config[key]);
        }
      } catch (error) {
        console.error("Error reading config.json:", error);
      }
      toast.success(t("Switch successful"));
      handleFetchBooks();
      setTimeout(() => {
        navigate("/manager/home");
      }, 2000);
    } else {
      try {
        const directoryHandle = await LocalFileManager.requestDirectoryAccess();

        if (directoryHandle) {
          // 成功获取权限
          ConfigService.setItem("isUseLocal", "yes");
          setState({
            storageLocation: directoryHandle.name,
          });
          toast.success(t("Local folder access granted successfully"));
          handleFetchBooks();
          setTimeout(() => {
            navigate("/manager/home");
          }, 2000);
        } else {
          toast.success(t("Failed to get folder access permission"));
        }
      } catch (error) {
        toast.error(
          "Error selecting folder:" +
            (error instanceof Error ? error.message : String(error))
        );
        console.error("Error selecting folder:", error);
        toast.success(t("Error occurred while selecting folder"));
      }
    }
  };
  const handleRestoreSnapshot = async (event: any) => {
    let targetFile = event.target.value;
    if (!targetFile) {
      return;
    }
    let confirm = await vexComfirmAsync(
      t(
        "Restoring from a snapshot will overwrite your current data. Are you sure you want to continue?"
      )
    );
    if (!confirm) {
      return;
    }
    let result = await restoreFromSnapshot(targetFile);
    if (result) {
      toast.success(t("Restore successful"), {
        id: "restore-snapshot",
      });
      handleFetchBooks();
      setTimeout(() => {
        navigate("/manager/home");
      }, 2000);
    }
    event.target.value = "";
  };
  const handleImportNotesData = async () => {
    const result = await importNotesData();
    if (result === "cancel" || result === "failed") {
      return;
    }
    const { imported, skipped } = result as {
      imported: number;
      skipped: number;
    };
    toast.success(
      t("Imported {{imported}} records, skipped {{skipped}} existing records", {
        imported,
        skipped,
      })
    );
    handleFetchBooks();
  };
  const render = () => {
    return (
      <>
        {isElectron && (
          <>
            <div className="setting-dialog-new-title">
              <Trans>Change storage location</Trans>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {" "}
                <span
                  className="change-location-button"
                  onClick={() => {
                    const ipcRenderer = window.electronAPI;
                    ipcRenderer.invoke("open-explorer-folder", {
                      path: stateRef.current.storageLocation,
                      isFolder: true,
                    });
                  }}
                  style={{ marginRight: "10px" }}
                >
                  <Trans>Locate</Trans>
                </span>
                <span
                  className="change-location-button"
                  onClick={() => {
                    handleChangeLocation();
                  }}
                >
                  <Trans>Select</Trans>
                </span>
              </div>
            </div>
            <p className="setting-option-subtitle">
              <Trans>
                {
                  "Modify the storage location of the library, and the library will be moved to the new location. Please ensure that the new folder is empty"
                }
              </Trans>
            </p>
            <div className="setting-dialog-location-title">
              {stateRef.current.storageLocation}
            </div>
          </>
        )}
        {stateRef.current.storageLocation && (
          <>
            <div className="setting-dialog-new-title">
              <Trans>Switch Library</Trans>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {isElectron && (
                  <span
                    className="change-location-button"
                    onClick={() => {
                      const ipcRenderer = window.electronAPI;
                      ipcRenderer.invoke("open-explorer-folder", {
                        path: stateRef.current.storageLocation,
                        isFolder: true,
                      });
                    }}
                    style={{ marginRight: "10px" }}
                  >
                    <Trans>Locate</Trans>
                  </span>
                )}
                <span
                  className="change-location-button"
                  onClick={() => {
                    handleSwitchLibrary();
                  }}
                >
                  <Trans>Select</Trans>
                </span>
              </div>
            </div>
            <p className="setting-option-subtitle">
              <Trans>
                {
                  "Switch between multiple libraries without affecting the original library."
                }
              </Trans>
            </p>
            <div className="setting-dialog-location-title">
              {stateRef.current.storageLocation}
            </div>
          </>
        )}
        {isElectron && (
          <>
            <div className="setting-dialog-new-title">
              <Trans>Restore from snapshots</Trans>
              <select
                name=""
                className="lang-setting-dropdown"
                onChange={handleRestoreSnapshot}
              >
                <option value={""} className="lang-setting-option">
                  {t("Please select")}
                </option>
                {stateRef.current.snapshotList
                  .map((item) => {
                    return {
                      label: new Date(item.time).toLocaleString(),
                      value: item.file,
                    };
                  })
                  .map((item) => (
                    <option
                      value={item.value}
                      key={item.value}
                      className="lang-setting-option"
                    >
                      {item.label}
                    </option>
                  ))}
              </select>
            </div>
            <p className="setting-option-subtitle">
              <Trans>
                {
                  "Each time you open KeSach, it automatically creates a snapshot of your library (excluding books and covers). You can use these snapshots to restore your library to a previous state. Please note that restoring from a snapshot will overwrite your current data"
                }
              </Trans>
            </p>
          </>
        )}
        <div className="setting-dialog-new-title">
          <Trans>Export all books</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              let books = await DatabaseService.getAllRecords("books");
              if (books.length > 0) {
                const result = await exportBooks(books);
                if (result === "success") {
                  toast.success(t("Export successful"), { id: "exporting" });
                } else if (result === "failed") {
                  toast.dismiss("exporting");
                  toast.error(t("Failed to export"), { id: "exporting" });
                }
              } else {
                toast(t("Nothing to export"));
              }
            }}
          >
            <Trans>Export</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Export all notes</Trans>
          <select
            className="lang-setting-dropdown"
            value={stateRef.current.exportNotesFormat}
            onChange={async (event) => {
              const fmt = event.target.value as
                | "csv"
                | "md"
                | "txt"
                | "html"
                | "pdf"
                | "json"
                | "";
              if (!fmt) return;
              setState({ exportNotesFormat: "" });
              let books = await DatabaseService.getAllRecords("books");
              let notes = await DatabaseService.getAllRecords("notes");
              notes = notes.filter(
                (note: any) =>
                  note.notes &&
                  note.notes.length > 0 &&
                  note.notes !== "annotation"
              );
              if (notes.length > 0) {
                const result = await exportNotes(notes, books, fmt);
                if (result === "success") {
                  toast.success(t("Export successful"), { id: "exporting" });
                } else if (result === "failed") {
                  toast.error(t("Failed to export"), { id: "exporting" });
                }
              } else {
                toast(t("Nothing to export"));
              }
            }}
          >
            <option value="" className="lang-setting-option">
              {t("Select format")}
            </option>
            <option value="csv" className="lang-setting-option">
              CSV
            </option>
            <option value="md" className="lang-setting-option">
              Markdown
            </option>
            <option value="txt" className="lang-setting-option">
              TXT
            </option>
            <option value="html" className="lang-setting-option">
              HTML
            </option>
            <option value="pdf" className="lang-setting-option">
              PDF
            </option>
            <option value="json" className="lang-setting-option">
              JSON
            </option>
          </select>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Export all highlights</Trans>
          <select
            className="lang-setting-dropdown"
            value={stateRef.current.exportHighlightsFormat}
            onChange={async (event) => {
              const fmt = event.target.value as
                | "csv"
                | "md"
                | "txt"
                | "html"
                | "pdf"
                | "json"
                | "";
              if (!fmt) return;
              setState({ exportHighlightsFormat: "" });
              let books = await DatabaseService.getAllRecords("books");
              let notes = await DatabaseService.getAllRecords("notes");
              notes = notes.filter((note: any) => note.notes === "");
              if (notes.length > 0) {
                const result = await exportHighlights(notes, books, fmt);
                if (result === "success") {
                  toast.success(t("Export successful"), { id: "exporting" });
                } else if (result === "failed") {
                  toast.error(t("Failed to export"), { id: "exporting" });
                }
              } else {
                toast(t("Nothing to export"));
              }
            }}
          >
            <option value="" className="lang-setting-option">
              {t("Select format")}
            </option>
            <option value="csv" className="lang-setting-option">
              CSV
            </option>
            <option value="md" className="lang-setting-option">
              Markdown
            </option>
            <option value="txt" className="lang-setting-option">
              TXT
            </option>
            <option value="html" className="lang-setting-option">
              HTML
            </option>
            <option value="pdf" className="lang-setting-option">
              PDF
            </option>
            <option value="json" className="lang-setting-option">
              JSON
            </option>
          </select>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Export all dictionary history</Trans>
          <select
            className="lang-setting-dropdown"
            value={stateRef.current.exportWordsFormat}
            onChange={async (event) => {
              const fmt = event.target.value as "csv" | "json" | "";
              if (!fmt) return;
              setState({ exportWordsFormat: "" });
              let dictHistory = await DatabaseService.getAllRecords("words");
              let books = await DatabaseService.getAllRecords("books");
              if (dictHistory.length > 0) {
                const result = await exportDictionaryHistory(
                  dictHistory,
                  books,
                  fmt
                );
                if (result === "success") {
                  toast.success(t("Export successful"), { id: "exporting" });
                } else if (result === "failed") {
                  toast.error(t("Failed to export"), { id: "exporting" });
                }
              } else {
                toast(t("Nothing to export"));
              }
            }}
          >
            <option value="" className="lang-setting-option">
              {t("Select format")}
            </option>
            <option value="csv" className="lang-setting-option">
              CSV
            </option>
            <option value="json" className="lang-setting-option">
              JSON
            </option>
          </select>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Import notes, highlights and dictionary history</Trans>
          <span
            className="change-location-button"
            onClick={handleImportNotesData}
          >
            <Trans>Select</Trans>
          </span>
        </div>
        <p className="setting-option-subtitle">
          <Trans>
            {
              "Select previously exported CSV or JSON files to import notes, highlights and dictionary history back to the library"
            }
          </Trans>
        </p>

        {isElectron && (
          <>
            <div className="setting-dialog-new-title">
              <Trans>Clear TTS cache</Trans>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                }}
              >
                <span
                  id="tts-cache-size"
                  style={{ marginRight: "10px", opacity: 0.6, fontSize: 13 }}
                >
                  {stateRef.current.ttsCacheSize}
                </span>
                <span
                  className="change-location-button"
                  onClick={handleClearTTSCache}
                >
                  <Trans>Clear</Trans>
                </span>
              </div>
            </div>
            <p className="setting-option-subtitle">
              <Trans>
                {
                  "Cached listen-book audio is stored locally and reused across sessions. Clearing it only frees up disk space"
                }
              </Trans>
            </p>
            <div className="setting-dialog-new-title">
              <Trans>Clear temp cache</Trans>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                }}
              >
                <span
                  id="temp-cache-size"
                  style={{ marginRight: "10px", opacity: 0.6, fontSize: 13 }}
                >
                  {stateRef.current.tempCacheSize}
                </span>
                <span
                  className="change-location-button"
                  onClick={handleClearTempCache}
                >
                  <Trans>Clear</Trans>
                </span>
              </div>
            </div>
            <p className="setting-option-subtitle">
              <Trans>
                {
                  "Cached comic extraction files, OCR results and full-text translations are stored locally and reused across sessions. Clearing them only frees up disk space"
                }
              </Trans>
            </p>
          </>
        )}
        <div className="setting-dialog-new-title">
          <Trans>Clear all data</Trans>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
            }}
          >
            <span
              id="all-data-size"
              style={{ marginRight: "10px", opacity: 0.6, fontSize: 13 }}
            >
              {stateRef.current.allDataSize}
            </span>
            <span
              className="change-location-button"
              onClick={async () => {
                let answer = await vexPromptAsync(
                  t("Please type 'CLEAR' to confirm"),
                  "",
                  ""
                );
                window.vex.closeAll(); // 关闭对话框
                if (answer === "CLEAR") {
                  await clearAllData();
                  toast.success(t("Clear successful"));
                  setTimeout(() => {
                    reloadManager();
                  }, 300);
                } else if (answer) {
                  toast.error(t("Please type 'CLEAR' to confirm"));
                }
              }}
            >
              <Trans>Clear</Trans>
            </span>
          </div>
        </div>
      </>
    );
  };

  return render();
};

export default DataSetting;
