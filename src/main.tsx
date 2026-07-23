import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PetWindow } from "./pet/PetWindow";
import { getSelectedPetSkin } from "./lib/bridge";
import { isPetSkinId } from "./pet/pet-skins";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const isPetWindow = params.get("window") === "pet";
const requestedSkin = params.get("skin");
const petSkin = isPetSkinId(requestedSkin) ? requestedSkin : getSelectedPetSkin();

document.documentElement.dataset.window = isPetWindow ? "pet" : "settings";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isPetWindow ? <PetWindow skin={petSkin} /> : <App />}</StrictMode>,
);
