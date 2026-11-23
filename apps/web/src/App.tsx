import { Navigate, Route, Routes } from "react-router";
import { pages } from "./pages/registry";

export default function App() {
  return (
    <Routes>
      {pages.map((page) => (
        <Route key={page.key} path={page.path} element={<page.Route />} />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
