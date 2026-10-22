import { Navigate, Route, Routes } from "react-router";
import LaunchPage from "./pages/LaunchPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LaunchPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
