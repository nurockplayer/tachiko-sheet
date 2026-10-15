import type { ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { LocalCopies } from "../../src/contracts.js";
import { WORK_FILE_SAVE_UNAVAILABLE } from "../../src/application/work-file.js";

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render }) }));
vi.mock("../../src/App.js", () => ({ App: () => null }));
vi.mock("../../src/runtime/session.js", () => ({ createSheetRuntime: vi.fn() }));
vi.mock("../../src/host/native-runtime.js", () => ({ createNativeKitLoader: vi.fn() }));
vi.mock("../../src/host/tauri-runtime-transport.js", () => ({ tauriRuntimeTransport: {} }));
vi.mock("../../src/host/tauri-host-files.js", () => ({ tauriHostFiles: {} }));
vi.mock("../../src/application/appearance-preference.js", () => ({ createAppearancePreferenceController: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("desktop boot exposes both portable local-copy writers used by the Save and Close flows", async () => {
  vi.stubEnv("MODE", "desktop");
  vi.stubGlobal("document", { getElementById: () => ({}) });
  await import("../../src/main.js");
  await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
  const hostCopy = render.mock.calls[0]![0] as ReactElement<{ children: ReactElement }>;
  const hostFiles = hostCopy.props.children as ReactElement<{ children: ReactElement }>;
  const app = hostFiles.props.children as ReactElement<{ copies: LocalCopies }>;
  expect(app.props.copies.createWorkFile).toBeTypeOf("function");
  expect(app.props.copies.replaceWorkFile).toBeTypeOf("function");
});

it("the unavailable local-save reason gives desktop users an available recovery action", () => {
  expect(WORK_FILE_SAVE_UNAVAILABLE).not.toMatch(/download/i);
  expect(WORK_FILE_SAVE_UNAVAILABLE).toMatch(/keep.*open/i);
});
