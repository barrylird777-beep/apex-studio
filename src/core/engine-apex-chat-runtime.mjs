import { createPureWalChatRuntime } from "./pure-wal-chat-runtime.mjs";

const runtime = createPureWalChatRuntime({ namespace: "engine_apex", actor: "engine-apex" });

export const getChatRuntimeState = runtime.getChatRuntimeState;
export const updateChatRuntimeState = runtime.updateChatRuntimeState;
export const recordChatRuntimeEvent = runtime.recordChatRuntimeEvent;
export const listChatRuntimeEvents = runtime.listChatRuntimeEvents;
export const closeChatRuntimeStore = runtime.closeChatRuntimeStore;
