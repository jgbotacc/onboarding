import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SharePage from "./share/SharePage";
import StaffPage from "./staff/StaffPage";
import "./styles.css";

// Hash route so the backend can keep serving web/dist at "/" with base "./": staff review lives at /#/staff (/#/review and the backend paths /staff, /review, /admin also work).
// The client share link is the backend path /share with the token in the fragment (/share#t=<token>), which browsers never send.
const isStaff = () => /^#\/(staff|review)\b/.test(window.location.hash) || /\/(staff|review|admin)\/?$/.test(window.location.pathname);
const isShare = () => /^#\/share\b/.test(window.location.hash) || /\/share\/?$/.test(window.location.pathname);
const staff = isStaff();
const share = isShare();
window.addEventListener("hashchange", () => (isStaff() !== staff || isShare() !== share) && window.location.reload());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {share ? <SharePage /> : staff ? <StaffPage /> : <App />}
  </StrictMode>,
);
