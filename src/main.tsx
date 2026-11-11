import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import App from "./App.tsx";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<App />);
