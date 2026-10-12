import { createPureWalChatRuntime } from "./pure-wal-chat-runtime.mjs";

const runtime = createPureWalChatRuntime({ namespace: "paypex", actor: "paypex" });

export const getChatRuntimeState = runtime.getChatRuntimeState;
export const updateChatRuntimeState = runtime.updateChatRuntimeState;
export const recordChatRuntimeEvent = runtime.recordChatRuntimeEvent;
export const listChatRuntimeEvents = runtime.listChatRuntimeEvents;
export const closeChatRuntimeStore = runtime.closeChatRuntimeStore;
