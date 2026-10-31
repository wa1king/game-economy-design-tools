import { loadBrowserRuntime } from "../runtime_loader.js";
function resolveAsset(flavor) {
  return flavor === "jspi" ? {
    jsUrl: new URL("../../wasm/cp_sat_runtime.js", import.meta.url).href,
    wasmUrl: new URL("../../wasm/cp_sat_runtime.wasm", import.meta.url).href
  } : {
    jsUrl: new URL("../../wasm/cp_sat_runtime_asyncify.js", import.meta.url).href,
    wasmUrl: new URL("../../wasm/cp_sat_runtime_asyncify.wasm", import.meta.url).href
  };
}
const loadRuntime = () => loadBrowserRuntime("cp_sat_runtime", resolveAsset), loadRuntimeAsyncify = () => loadBrowserRuntime("cp_sat_runtime", resolveAsset, "asyncify");
export {
  loadRuntime,
  loadRuntimeAsyncify
};
