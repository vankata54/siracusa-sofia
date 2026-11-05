import base from "./playwright.config";
export default { ...base, use: { ...base.use, baseURL: "http://localhost:8806" }, webServer: undefined };
