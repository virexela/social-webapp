import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import ChatPage from "@/app/chat/[chatId]/page";

const CHAT_ID = "0102030405060708090a0b0c0d0e0f10";

const encryptMessageMock = jest.fn();
const decryptMessageMock = jest.fn();
const isIdentityLoadedMock = jest.fn(async () => true);

const sendCiphertextBlobMock = jest.fn(async () => {});
const fetchCiphertextBlobsMock = jest.fn(async () => []);
const socketConnectMock = jest.fn(async () => {});
const refreshConnectionsFromWasmMock = jest.fn(async () => {});
const addMessageMock = jest.fn();
const setMessageStatusMock = jest.fn();
const activatePendingContactMock = jest.fn();
const setNicknameMock = jest.fn();

let mockState: {
  nicknamesByConnectionId: Record<string, string>;
  messagesByConnectionId: Record<string, Array<{ id: string; isOwn: boolean; status?: string }>>;
  contacts: Array<{ connectionIdHex: string; nickname: string; status: "pending_outgoing" | "connected" | "invite_expired" }>;
  refreshConnectionsFromWasm: () => Promise<void>;
  addMessage: (...args: unknown[]) => void;
  setMessageStatus: (...args: unknown[]) => void;
  activatePendingContact: (...args: unknown[]) => void;
  setNickname: (...args: unknown[]) => void;
};

const useSocialStoreMock = ((selector: (state: typeof mockState) => unknown) =>
  selector(mockState)) as unknown as {
  (selector: (state: typeof mockState) => unknown): unknown;
  getState: () => typeof mockState;
};

useSocialStoreMock.getState = () => mockState;

jest.mock("next/navigation", () => ({
  useParams: () => ({ chatId: CHAT_ID }),
  useRouter: () => ({ back: jest.fn(), replace: jest.fn() }),
}));

jest.mock("@/lib/state/store", () => ({
  useSocialStore: (selector: (state: typeof mockState) => unknown) =>
    useSocialStoreMock(selector),
}));

jest.mock("@/lib/crypto", () => ({
  getCrypto: () => ({
    is_identity_loaded: isIdentityLoadedMock,
    encrypt_message: encryptMessageMock,
    decrypt_message: decryptMessageMock,
  }),
}));

jest.mock("@/lib/crypto/lifecycle", () => ({
  restoreIdentityFromIndexedDb: async () => true,
  persistIdentityToIndexedDb: async () => {},
}));

jest.mock("@/lib/network/relaySend", () => ({
  sendCiphertextBlob: (...args: unknown[]) => sendCiphertextBlobMock(...args),
}));

jest.mock("@/lib/network/relayFetch", () => ({
  fetchCiphertextBlobs: (...args: unknown[]) => fetchCiphertextBlobsMock(...args),
}));

jest.mock("@/lib/network/socket", () => ({
  RelaySocket: jest.fn().mockImplementation(() => ({
    connectAndWaitOpen: (...args: unknown[]) => socketConnectMock(...args),
    close: jest.fn(),
  })),
}));

jest.mock("@/lib/protocol/hash", () => ({
  sha256: async () => new Uint8Array([1, 2, 3]),
}));

jest.mock("@/lib/protocol/base64url", () => ({
  bytesToBase64Url: () => "msg-id",
}));

jest.mock("framer-motion", () => {
  const Pass = ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", props, children);
  return {
    motion: new Proxy(
      {},
      {
        get: () => Pass,
      }
    ),
  };
});

jest.mock("lucide-react", () => new Proxy({}, { get: () => () => null }));

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
}

function clickSendButton(container: HTMLDivElement) {
  const sendButton = Array.from(container.querySelectorAll("button")).find(
    (btn) => !btn.getAttribute("aria-label") && !btn.disabled
  ) as HTMLButtonElement | undefined;
  if (!sendButton) throw new Error("Send button not found");
  sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean, maxTicks = 20) {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error("Timed out waiting for condition");
}

describe("ChatPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      nicknamesByConnectionId: {},
      messagesByConnectionId: {},
      contacts: [],
      refreshConnectionsFromWasm: refreshConnectionsFromWasmMock,
      addMessage: addMessageMock,
      setMessageStatus: setMessageStatusMock,
      activatePendingContact: activatePendingContactMock,
      setNickname: setNicknameMock,
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("blocks sending for invite_expired contact", async () => {
    mockState.contacts = [
      { connectionIdHex: CHAT_ID, nickname: "Peer", status: "invite_expired" },
    ];

    await act(async () => {
      root.render(<ChatPage />);
    });
    await act(async () => {
      await waitFor(() => socketConnectMock.mock.calls.length > 0);
    });

    const input = container.querySelector(
      'input[placeholder="Type a secure message..."]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();

    await act(async () => {
      setInputValue(input, "hello");
      input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      clickSendButton(container);
      await flush();
    });

    expect(encryptMessageMock).not.toHaveBeenCalled();
  });

  it("initializes connected chat transport and polling", async () => {
    mockState.contacts = [
      { connectionIdHex: CHAT_ID, nickname: "Peer", status: "connected" },
    ];

    await act(async () => {
      root.render(<ChatPage />);
    });
    await act(async () => {
      await waitFor(() => socketConnectMock.mock.calls.length > 0);
      await flush();
    });

    const input = container.querySelector(
      'input[placeholder="Type a secure message..."]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(socketConnectMock).toHaveBeenCalled();
  });
});
