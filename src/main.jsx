import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installerTraceGlobale } from "./lib/trace";
import "./index.css";

installerTraceGlobale();

function demarrer() {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Hors de Tauri en developpement : mode apercu (voir src/apercu.js). Le test
// sur import.meta.env.DEV fait disparaitre ce code du build de l'appli.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  import("./apercu")
    .then(({ installerApercu }) => installerApercu())
    .then(demarrer)
    .catch((e) => {
      document.body.textContent = `Apercu impossible : ${e.message}`;
    });
} else {
  demarrer();
}
