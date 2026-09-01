import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import ZkLoginCallbackPage from "./pages/ZkLoginCallbackPage";
import "./styles.css";

const isZkLoginCallback = window.location.pathname === "/zklogin";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isZkLoginCallback ? (
      <ZkLoginCallbackPage />
    ) : (
      <HashRouter>
        <App />
      </HashRouter>
    )}
  </React.StrictMode>
);
