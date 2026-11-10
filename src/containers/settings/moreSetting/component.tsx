import { useLatest } from "../../../utils/hooks/useLatest";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import {
  clearProtection,
  getBiometricCapability,
  getBiometricErrorMessage,
  promptBiometricAuth,
  setProtectionBiometric,
  verifyPassword,
  verifyPin,
  setProtectionPassword,
  setProtectionPin,
} from "../../../utils/reader/protectionUtil";
import { vexPasswordInputAsync, vexSelectAsync } from "../../../utils/common";
import i18n from "../../../i18n";
import TokenService from "../../../utils/storage/tokenService";
import SwitchRow from "../../../components/readerSettings/switchRow";

export interface MoreSettingState {
  protectionMethod: string;
  biometricAvailable: boolean;
  pinInputMode: "none" | "setup-enter" | "setup-confirm" | "verify";
  pinValue: string;
  pinFirstValue: string;
  pinCallback: ((pin: string | false) => void) | null;
}

const MoreSetting = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<MoreSettingState>({
    protectionMethod: "",
    biometricAvailable: false,
    pinInputMode: "none",
    pinValue: "",
    pinFirstValue: "",
    pinCallback: null,
  });
  const stateRef = useLatest(state);

  const updateState = (patch: Partial<MoreSettingState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState((prev) => ({ ...prev, ...patch }));
  };

  useEffect(() => {
    Promise.all([
      TokenService.getToken("protection_method"),
      getBiometricCapability(),
    ]).then(([method, biometricCapability]) => {
      updateState({
        protectionMethod: method || "",
        biometricAvailable: biometricCapability.available,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showPinKeypad = (mode: "setup" | "verify"): Promise<string | false> => {
    return new Promise((resolve) => {
      updateState({
        pinInputMode: mode === "setup" ? "setup-enter" : "verify",
        pinValue: "",
        pinFirstValue: "",
        pinCallback: resolve,
      });
    });
  };

  const handlePinDigit = (digit: string) => {
    const { pinValue, pinInputMode, pinFirstValue, pinCallback } =
      stateRef.current;
    if (pinValue.length >= 6) return;
    const next = pinValue + digit;
    if (next.length === 6) {
      if (pinInputMode === "setup-enter") {
        updateState({
          pinInputMode: "setup-confirm",
          pinFirstValue: next,
          pinValue: "",
        });
      } else if (pinInputMode === "setup-confirm") {
        if (next === pinFirstValue) {
          updateState({
            pinInputMode: "none",
            pinValue: "",
            pinFirstValue: "",
          });
          pinCallback && pinCallback(next);
        } else {
          toast.error(t("PINs do not match, please try again"));
          updateState({
            pinValue: "",
            pinFirstValue: "",
            pinInputMode: "setup-enter",
          });
        }
      } else if (pinInputMode === "verify") {
        updateState({ pinInputMode: "none", pinValue: "" });
        pinCallback && pinCallback(next);
      }
      return;
    }
    updateState({ pinValue: next });
  };

  const handlePinDelete = () => {
    updateState({ pinValue: stateRef.current.pinValue.slice(0, -1) });
  };

  const handlePinCancel = () => {
    const { pinCallback } = stateRef.current;
    updateState({
      pinInputMode: "none",
      pinValue: "",
      pinFirstValue: "",
      pinCallback: null,
    });
    pinCallback && pinCallback(false);
  };

  const verifyCurrentMethod = async (): Promise<boolean> => {
    const { protectionMethod } = stateRef.current;
    if (protectionMethod === "password") {
      const input = await vexPasswordInputAsync(
        i18n.t("Enter your current password")
      );
      if (!input) return false;
      const ok = await verifyPassword(input as string);
      if (!ok) toast.error(t("Incorrect password"));
      return ok;
    } else if (protectionMethod === "pin") {
      const pin = await showPinKeypad("verify");
      if (pin === false) return false;
      const ok = await verifyPin(pin as string);
      if (!ok) toast.error(t("Incorrect PIN"));
      return ok;
    } else if (protectionMethod === "biometric") {
      const result = await promptBiometricAuth(
        i18n.t("Authenticate to change protection settings")
      );
      if (!result.success) {
        toast.error(getBiometricErrorMessage(result.code, t));
      }
      return result.success;
    }
    return true;
  };

  const handleToggleProtection = async () => {
    const { protectionMethod, biometricAvailable } = stateRef.current;
    if (protectionMethod) {
      const verified = await verifyCurrentMethod();
      if (!verified) return;
      await clearProtection();
      updateState({ protectionMethod: "" });
      toast.success(t("Change successful"));
    } else {
      const methodOptions: { value: string; label: string }[] = [
        { value: "password", label: "Password" },
        { value: "pin", label: "PIN" },
      ];
      if (biometricAvailable) {
        methodOptions.push({ value: "biometric", label: "Biometric" });
      }
      const method = await vexSelectAsync(
        "Select protection method",
        methodOptions
      );
      if (!method) return;
      await setupMethod(method as string);
    }
  };

  const handleChangeMethod = async (newMethod: string) => {
    const { protectionMethod } = stateRef.current;
    if (newMethod === protectionMethod) return;
    const verified = await verifyCurrentMethod();
    if (!verified) return;
    await setupMethod(newMethod);
  };

  const setupMethod = async (method: string) => {
    if (method === "password") {
      const input = await vexPasswordInputAsync(
        i18n.t("Enter new password"),
        i18n.t("Confirm new password")
      );
      if (input === false) {
        toast.error(t("Passwords do not match or input is empty"));
        return;
      }
      await setProtectionPassword(input as string);
      updateState({ protectionMethod: "password" });
      toast.success(t("Change successful"));
    } else if (method === "pin") {
      const pin = await showPinKeypad("setup");
      if (pin === false) return;
      await setProtectionPin(pin as string);
      updateState({ protectionMethod: "pin" });
      toast.success(t("Change successful"));
    } else if (method === "biometric") {
      if (!stateRef.current.biometricAvailable) {
        toast.error(
          t("Biometric authentication is not available on this device")
        );
        return;
      }
      const result = await promptBiometricAuth(
        i18n.t("Authenticate to enable biometric protection")
      );
      if (!result.success) {
        toast.error(getBiometricErrorMessage(result.code, t));
        return;
      }
      await setProtectionBiometric();
      updateState({ protectionMethod: "biometric" });
      toast.success(t("Change successful"));
    }
  };

  const renderPinKeypad = () => {
    const { pinInputMode, pinValue } = state;
    if (pinInputMode === "none") return null;

    let title = "";
    if (pinInputMode === "setup-enter") title = i18n.t("Enter new 6-digit PIN");
    else if (pinInputMode === "setup-confirm")
      title = i18n.t("Confirm new 6-digit PIN");
    else if (pinInputMode === "verify")
      title = i18n.t("Enter your current PIN");

    const digits: (number | "del" | null)[] = [
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      null,
      0,
      "del",
    ];

    return (
      <div className="pin-keypad-overlay">
        <div className="pin-keypad-container">
          <div className="pin-keypad-title">{title}</div>
          <div className="pin-dots">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={`pin-dot${i < pinValue.length ? " pin-dot-filled" : ""}`}
              />
            ))}
          </div>
          <div className="pin-keypad-grid">
            {digits.map((d, idx) => {
              if (d === null) {
                return <span key={idx} className="pin-key pin-key-empty" />;
              }
              if (d === "del") {
                return (
                  <button
                    key={idx}
                    className="pin-key pin-key-empty"
                    onClick={handlePinDelete}
                  >
                    <span
                      className="icon-close"
                      style={{ fontSize: "18px" }}
                    ></span>
                  </button>
                );
              }
              return (
                <button
                  key={idx}
                  className="pin-key"
                  onClick={() => handlePinDigit(String(d))}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <button className="pin-key-cancel" onClick={handlePinCancel}>
            <Trans>Cancel</Trans>
          </button>
        </div>
      </div>
    );
  };

  const { protectionMethod, biometricAvailable } = state;
  const isEnabled = !!protectionMethod;
  const showBiometricOption =
    biometricAvailable || protectionMethod === "biometric";

  return (
    <>
      {renderPinKeypad()}
      <SwitchRow
        variant="setting"
        title={<Trans>Enable software protection</Trans>}
        isEnabled={isEnabled}
        onClick={handleToggleProtection}
      />
      <p className="setting-option-subtitle">
        <Trans>
          When enabled, the app will require authentication on every launch
        </Trans>
      </p>

      {isEnabled && (
        <>
          <div className="setting-dialog-new-title" key="protection-method">
            <Trans>Protection method</Trans>
            <select
              className="lang-setting-dropdown"
              value={protectionMethod}
              onChange={(e) => handleChangeMethod(e.target.value)}
              style={{ textAlign: "left" }}
            >
              <option value="password">{t("Password")}</option>
              <option value="pin">{t("PIN")}</option>
              {showBiometricOption && (
                <option value="biometric">{t("Biometric")}</option>
              )}
            </select>
          </div>
          <p className="setting-option-subtitle">
            {protectionMethod === "password" && (
              <Trans>Use a custom password to protect the app</Trans>
            )}
            {protectionMethod === "pin" && (
              <Trans>Use a 6-digit PIN to protect the app</Trans>
            )}
            {protectionMethod === "biometric" && (
              <Trans>Use Touch ID or Windows Hello to protect the app</Trans>
            )}
          </p>
        </>
      )}
    </>
  );
};

export default MoreSetting;
