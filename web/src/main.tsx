import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import StaffPage from "./staff/StaffPage";
import VoiceApp from "./voice/VoiceApp";
import "./styles.css";

// Hash route so the backend can keep serving web/dist at "/" with base "./": staff review lives at /#/staff (/#/review and the backend paths /staff, /review, /admin also work). The talk-only VoiceApp is the client home page at "/"; the classic chat App lives at "#/chat".
const isStaff = () => /^#\/(staff|review)\b/.test(window.location.hash) || /\/(staff|review|admin)\/?$/.test(window.location.pathname);
const isChat = () => /^#\/chat\b/.test(window.location.hash);
const staff = isStaff();
const chat = isChat();
window.addEventListener("hashchange", () => (isStaff() !== staff || isChat() !== chat) && window.location.reload());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {staff ? <StaffPage /> : chat ? <App /> : <VoiceApp />}
  </StrictMode>,
);
