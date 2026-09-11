import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Depenses from "./pages/Depenses";
import Revenus from "./pages/Revenus";
import Abonnements from "./pages/Abonnements";
import Sites from "./pages/Sites";

export default function App() {
  const [onglet, setOnglet] = useState("dashboard");
  const [cheminBase, setCheminBase] = useState("");
  // Incremente a chaque ecriture en base: force le tableau de bord a se recalculer
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    invoke("chemin_base")
      .then(setCheminBase)
      .catch(() => setCheminBase(""));
  }, []);

  const signalerModification = () => setRevision((r) => r + 1);

  const pages = {
    dashboard: <Dashboard rafraichissement={revision} />,
    depenses: <Depenses onModification={signalerModification} />,
    revenus: <Revenus onModification={signalerModification} />,
    abonnements: <Abonnements onModification={signalerModification} />,
    sites: <Sites onModification={signalerModification} />,
  };

  return (
    <Layout ongletActif={onglet} onChangerOnglet={setOnglet} cheminBase={cheminBase}>
      {pages[onglet]}
    </Layout>
  );
}
