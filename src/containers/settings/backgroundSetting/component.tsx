import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import "./backgroundSetting.css";
import { Trans } from "react-i18next";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import toast from "react-hot-toast";
import { applyAppBackgroundImage } from "../../../utils/reader/launchUtil";
import BackgroundUtil from "../../../utils/file/backgroundUtil";
import { useAppStore } from "../../../store/useAppStore";

export interface BackgroundImage {
  id: string;
  name: string;
  extension: string;
  textColor?: string;
  backgroundColor?: string;
}

export interface SettingInfoState {
  images: BackgroundImage[];
  /** loaded dataUrls keyed by image id */
  loadedUrls: Record<string, string>;
  previewImage: BackgroundImage | null;
  appBackgroundId: string;
  readerBackgroundId: string;
  isLoading: boolean;
}

const BackgroundSetting = () => {
  const handleReaderBackgroundImage = useAppStore(
    (s) => s.handleReaderBackgroundImage
  );
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<SettingInfoState>({
    images: [],
    loadedUrls: {},
    previewImage: null,
    appBackgroundId:
      ConfigService.getReaderConfig("appBackgroundImage") || "",
    readerBackgroundId:
      ConfigService.getReaderConfig("readerBackgroundImage") || "",
    isLoading: true,
  });

  const loadAllImages = async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    const ids = BackgroundUtil.getImageIds();
    const images: BackgroundImage[] = [];
    const loadedUrls: Record<string, string> = {};

    for (const id of ids) {
      const meta = BackgroundUtil.getImageMeta(id);
      if (!meta) continue;
      images.push({
        id,
        name: meta.name,
        extension: meta.extension,
        textColor: meta.textColor,
        backgroundColor: meta.backgroundColor,
      });
      const url = await BackgroundUtil.loadImage(id, meta.extension);
      if (url) loadedUrls[id] = url;
    }

    setState((prev) => ({ ...prev, images, loadedUrls, isLoading: false }));
  };

  useEffect(() => {
    loadAllImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;

      const id = Date.now().toString();
      const { extension } = BackgroundUtil.convertDataUrl(dataUrl);

      // Analyse dominant color before saving metadata
      const { backgroundColor, textColor } =
        await BackgroundUtil.analyzeImageColors(dataUrl);

      const meta = { name: file.name, extension, backgroundColor, textColor };

      try {
        await BackgroundUtil.saveImage(id, dataUrl);
        BackgroundUtil.saveImageMeta(id, meta);
        BackgroundUtil.addImageId(id);

        const newImage: BackgroundImage = {
          id,
          name: file.name,
          extension,
          backgroundColor,
          textColor,
        };
        setState((prev) => ({
          ...prev,
          images: [...prev.images, newImage],
          loadedUrls: { ...prev.loadedUrls, [id]: dataUrl },
        }));
        toast.success(t("Import successful"));
      } catch (err) {
        console.error(err);
        toast.error(t("Import failed"));
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePreview = (image: BackgroundImage) => {
    setState((prev) => ({ ...prev, previewImage: image }));
  };

  const handleClosePreview = () => {
    setState((prev) => ({ ...prev, previewImage: null }));
  };

  const handleSetAppBackground = (image: BackgroundImage) => {
    ConfigService.setReaderConfig("appBackgroundImage", image.id);
    setState((prev) => ({ ...prev, appBackgroundId: image.id }));
    applyAppBackgroundImage();
    toast.success(t("Change successful"));
  };

  const handleClearAppBackground = () => {
    ConfigService.setReaderConfig("appBackgroundImage", "");
    setState((prev) => ({ ...prev, appBackgroundId: "" }));
    applyAppBackgroundImage();
    toast.success(t("Change successful"));
  };

  const handleSetReaderBackground = (image: BackgroundImage) => {
    ConfigService.setReaderConfig("readerBackgroundImage", image.id);
    if (image.textColor) {
      ConfigService.setReaderConfig("textColor", image.textColor);
    }
    if (image.backgroundColor) {
      ConfigService.setReaderConfig("backgroundColor", image.backgroundColor);
    }
    setState((prev) => ({ ...prev, readerBackgroundId: image.id }));
    handleReaderBackgroundImage?.(image.id);
    toast.success(t("Change successful"));
  };

  const handleClearReaderBackground = () => {
    ConfigService.setReaderConfig("readerBackgroundImage", "");
    setState((prev) => ({ ...prev, readerBackgroundId: "" }));
    handleReaderBackgroundImage?.(
"");
    toast.success(t("Change successful"));
    ConfigService.setReaderConfig("textColor", "");
    ConfigService.setReaderConfig("backgroundColor", "");
  };

  const handleDelete = async (e: React.MouseEvent, image: BackgroundImage) => {
    e.stopPropagation();
    try {
      await BackgroundUtil.deleteImage(image.id);
      BackgroundUtil.deleteImageMeta(image.id);
      BackgroundUtil.removeImageId(image.id);

      const updatedUrls = { ...state.loadedUrls };
      delete updatedUrls[image.id];

      setState((prev) => ({
        ...prev,
        images: prev.images.filter((img) => img.id !== image.id),
        loadedUrls: updatedUrls,
      }));

      if (state.appBackgroundId === image.id) {
        ConfigService.setReaderConfig("appBackgroundImage", "");
        setState((prev) => ({ ...prev, appBackgroundId: "" }));
        applyAppBackgroundImage();
      }
      if (state.readerBackgroundId === image.id) {
        ConfigService.setReaderConfig("readerBackgroundImage", "");
        setState((prev) => ({ ...prev, readerBackgroundId: "" }));
    handleReaderBackgroundImage?.("");
      }
      toast.success(t("Deletion successful"));
    } catch (err) {
      console.error(err);
      toast.error(t("Deletion failed"));
    }
  };

  const renderBadge = (image: BackgroundImage) => {
    const isApp = state.appBackgroundId === image.id;
    const isReader = state.readerBackgroundId === image.id;
    if (!isApp && !isReader) return null;
    return (
      <span className="background-setting-badge">
        {isApp && <Trans>App</Trans>}
        {isApp && isReader && " · "}
        {isReader && <Trans>Reader</Trans>}
      </span>
    );
  };

  const renderPreviewActions = (previewImage: BackgroundImage) => {
    const isApp = state.appBackgroundId === previewImage.id;
    const isReader = state.readerBackgroundId === previewImage.id;
    return (
      <div
        className="background-preview-actions"
        onClick={(e) => e.stopPropagation()}
      >
        {isApp ? (
          <span
            className="change-location-button background-apple-button"
            style={{ fontSize: "14px", padding: "6px 16px", height: "32px" }}
            onClick={handleClearAppBackground}
          >
            <Trans>Clear app background</Trans>
          </span>
        ) : (
          <span
            className="change-location-button background-apple-button"
            style={{ fontSize: "14px", padding: "6px 16px", height: "32px" }}
            onClick={() => handleSetAppBackground(previewImage)}
          >
            <Trans>Set as app background</Trans>
          </span>
        )}
        {isReader ? (
          <span
            className="change-location-button background-apple-button"
            style={{ fontSize: "14px", padding: "6px 16px", height: "32px" }}
            onClick={handleClearReaderBackground}
          >
            <Trans>Clear book background</Trans>
          </span>
        ) : (
          <span
            className="change-location-button background-apple-button"
            style={{ fontSize: "14px", padding: "6px 16px", height: "32px" }}
            onClick={() => handleSetReaderBackground(previewImage)}
          >
            <Trans>Set as book background</Trans>
          </span>
        )}
      </div>
    );
  };

  const { images, previewImage, loadedUrls, isLoading } = state;

  return (
    <>
      <div className="background-setting-grid">
        {isLoading ? (
          <div className="background-setting-empty">
            <Trans>Loading...</Trans>
          </div>
        ) : images.length === 0 ? (
          <div className="background-setting-empty">
            <Trans>No background images added yet</Trans>
          </div>
        ) : (
          images.map((img) => (
            <div
              key={img.id}
              className={
                "background-setting-item" +
                (state.appBackgroundId === img.id ||
                state.readerBackgroundId === img.id
                  ? " active-bg-item"
                  : "")
              }
              onClick={() => handlePreview(img)}
              title={img.name}
            >
              {loadedUrls[img.id] ? (
                <img
                  className="background-setting-img"
                  src={loadedUrls[img.id]}
                  alt={img.name}
                />
              ) : (
                <div className="background-setting-img background-setting-placeholder" />
              )}
              {renderBadge(img)}
              <span
                className="background-setting-delete icon-close"
                onClick={(e) => handleDelete(e, img)}
              />
            </div>
          ))
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Import button fixed at bottom-right */}
      <div className="setting-dialog-new-plugin" onClick={handleImportClick}>
        <span style={{ fontWeight: "bold" }}>
          <Trans>Import local image</Trans>
        </span>
      </div>

      {/* Preview overlay */}
      {previewImage && (
        <div
          className="background-preview-overlay"
          onClick={handleClosePreview}
        >
          <span
            className="background-preview-close icon-close"
            onClick={handleClosePreview}
          />
          <img
            className="background-preview-image"
            src={loadedUrls[previewImage.id] || ""}
            alt={previewImage.name}
            onClick={(e) => e.stopPropagation()}
          />
          {renderPreviewActions(previewImage)}
        </div>
      )}

    </>
  );
};

export default BackgroundSetting;
