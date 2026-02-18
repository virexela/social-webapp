import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { bytesToBase64Url } from "@/lib/protocol/base64url";
import { AddContactModal } from "@/components/AddContactModal";

const mockSetSelectedChatId = jest.fn();
const mockRefreshConnectionsFromWasm = jest.fn(async () => {});
const mockAddPendingOutgoingContact = jest.fn();
const mockAddConnectedContact = jest.fn();

const mockStore = {
  setSelectedChatId: mockSetSelectedChatId,
  refreshConnectionsFromWasm: mockRefreshConnectionsFromWasm,
  addPendingOutgoingContact: mockAddPendingOutgoingContact,
  addConnectedContact: mockAddConnectedContact,
  contacts: [],
};

const listConnectionsMock = jest.fn();
const createInviteMock = jest.fn();
const acceptInviteMock = jest.fn();
const encryptMessageMock = jest.fn();

const cryptoMock = {
  list_connections: listConnectionsMock,
  create_invite: createInviteMock,
  accept_invite: acceptInviteMock,
  encrypt_message: encryptMessageMock,
};

const persistIdentityMock = jest.fn(async () => {});
const syncEncryptedStateMock = jest.fn(async () => {});

jest.mock("@/lib/state/store", () => ({
  useSocialStore: Object.assign(
    (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
    { getState: () => mockStore }
  ),
}));

jest.mock("@/lib/crypto", () => ({
  getCrypto: () => cryptoMock,
}));

jest.mock("@/lib/crypto/lifecycle", () => ({
  persistIdentityToIndexedDb: () => persistIdentityMock(),
}));

jest.mock("@/lib/sync/stateSync", () => ({
  syncEncryptedStateBestEffort: (...args: unknown[]) =>
    syncEncryptedStateMock(...args),
}));

jest.mock("framer-motion", () => {
  const Pass = ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", props, children);
  return {
    AnimatePresence: Pass,
    motion: new Proxy(
      {},
      {
        get: () => Pass,
      }
    ),
  };
});

jest.mock("lucide-react", () => new Proxy({}, { get: () => () => null }));
jest.mock("qrcode.react", () => ({ QRCodeCanvas: () => null }));
jest.mock("@zxing/browser", () => ({ BrowserQRCodeReader: class {} }));

function clickByText(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (el) => el.textContent?.trim() === label
  ) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Button not found: ${label}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("AddContactModal", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalPrompt = window.prompt;

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.prompt = jest.fn(() => "Alice");
  });

  afterEach(() => {
    window.prompt = originalPrompt;
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("creates and stores pending invite from send-invite flow", async () => {
    const invite = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));
    const connection = new Uint8Array(16).fill(7);
    listConnectionsMock
      .mockResolvedValueOnce(new Uint8Array())
      .mockResolvedValueOnce(connection);
    createInviteMock.mockResolvedValue(invite);

    await act(async () => {
      root.render(<AddContactModal open onClose={() => {}} />);
    });

    await act(async () => {
      clickByText("Send invite");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistIdentityMock).toHaveBeenCalledTimes(1);
    expect(mockRefreshConnectionsFromWasm).toHaveBeenCalledTimes(1);

    const nameInput = document.querySelector(
      'input[placeholder="Enter contact name"]'
    ) as HTMLInputElement;
    expect(nameInput).toBeTruthy();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      valueSetter?.call(nameInput, "Alice");
      nameInput.dispatchEvent(
        new Event("input", { bubbles: true, cancelable: true })
      );
    });

    await act(async () => {
      clickByText("Done");
    });

    const expectedToken = bytesToBase64Url(invite);
    expect(mockAddPendingOutgoingContact).toHaveBeenCalledWith(
      "Alice",
      expectedToken,
      "07070707070707070707070707070707"
    );
    expect(mockSetSelectedChatId).toHaveBeenCalledWith(
      "07070707070707070707070707070707"
    );
  });

  it("accepts invite and links contact", async () => {
    jest.useFakeTimers();
    const invite = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 2));
    const token = bytesToBase64Url(invite);
    const connection = new Uint8Array(16).fill(9);
    const ciphertext = new Uint8Array([1, 2, 3]);

    acceptInviteMock.mockResolvedValue(connection);
    encryptMessageMock.mockResolvedValue(ciphertext);
    window.prompt = jest.fn(() => "Bob");

    const onClose = jest.fn();
    await act(async () => {
      root.render(
        <AddContactModal open onClose={onClose} initialStep="accept-invite" />
      );
    });

    const textarea = document.querySelector(
      'textarea[placeholder="Paste invite code here..."]'
    ) as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      valueSetter?.call(textarea, token);
      textarea.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(600);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAddConnectedContact).toHaveBeenCalledWith(
      "Bob",
      "09090909090909090909090909090909"
    );
    expect(mockSetSelectedChatId).toHaveBeenCalledWith(
      "09090909090909090909090909090909"
    );
    expect(persistIdentityMock).toHaveBeenCalledTimes(1);
    expect(mockRefreshConnectionsFromWasm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
