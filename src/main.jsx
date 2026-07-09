import React from "react";
import { createRoot } from "react-dom/client";
import NeighborhoodIQ from "./NeighborhoodIQ.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <NeighborhoodIQ />
  </React.StrictMode>
);
