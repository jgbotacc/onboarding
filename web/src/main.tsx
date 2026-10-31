import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import StaffPage from "./staff/StaffPage";
import "./styles.css";

// Hash route so the backend can keep serving web/dist at "/" with base "./": staff review lives at /#/staff (/#/review and the backend paths /staff, /review, /admin also work).
const isStaff = () => /^#\/(staff|review)\b/.test(window.location.hash) || /\/(staff|review|admin)\/?$/.test(window.location.pathname);
const staff = isStaff();
window.addEventListener("hashchange", () => isStaff() !== staff && window.location.reload());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {staff ? <StaffPage /> : <App />}
  </StrictMode>,
);
