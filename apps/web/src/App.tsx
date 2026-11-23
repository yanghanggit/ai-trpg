import { Navigate, Route, Routes } from "react-router";
import EntryPage from "./pages/EntryPage";
import GamePage from "./pages/GamePage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EntryPage />} />
      <Route path="/g/:slug" element={<GamePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
