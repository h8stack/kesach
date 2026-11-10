import { Trans } from "react-i18next";
import packageJson from "../../../../package.json";
import { isElectron } from "react-device-detect";

declare var window: any;

const AboutSetting = () => {
  return (
    <>
      <div className="setting-dialog-new-title">
        <Trans>Current version</Trans>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span>{packageJson.version}</span>
        </div>
      </div>
      {isElectron && (
        <div className="setting-dialog-new-title">
          <Trans>Get debug logs</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              const ipcRenderer = window.electronAPI;
              ipcRenderer.invoke("get-debug-logs", "ping");
            }}
          >
            <Trans>Locate</Trans>
          </span>
        </div>
      )}

      {isElectron && (
        <div className="setting-dialog-new-title">
          <Trans>Open console</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              window.electronAPI.invoke("open-console", "ping");
            }}
          >
            <Trans>View</Trans>
          </span>
        </div>
      )}
    </>
  );
};

export default AboutSetting;
