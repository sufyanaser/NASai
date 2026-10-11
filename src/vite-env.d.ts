/// <reference types="vite/client" />

type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "disabled";

interface UpdateStatus {
  state: UpdateState;
  message: string;
  progress?: number;
  version?: string;
}

interface Window {
  nasai?: {
    getAppInfo: () => Promise<{
      version: string;
      platform: string;
      packaged: boolean;
    }>;
    checkForUpdates: () => Promise<UpdateStatus>;
    installUpdate: () => Promise<void>;
    minimizeWindow: () => void;
    toggleMaximizeWindow: () => void;
    closeWindow: () => void;
    onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
  };
}
