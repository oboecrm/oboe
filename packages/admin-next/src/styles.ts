import type React from "react";

export const shellStyle: React.CSSProperties = {
  background:
    "radial-gradient(circle at top left, rgba(218, 240, 229, 0.9), rgba(242, 238, 226, 0.95) 45%, rgba(255, 255, 255, 1) 100%)",
  color: "#102418",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  minHeight: "100vh",
  padding: "32px",
};

export const panelStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.88)",
  border: "1px solid rgba(16, 36, 24, 0.08)",
  borderRadius: "20px",
  boxShadow: "0 18px 48px rgba(16, 36, 24, 0.08)",
  padding: "24px",
};

export const mutedStyle: React.CSSProperties = {
  color: "#476452",
};

export const fieldInputStyle: React.CSSProperties = {
  border: "1px solid rgba(16, 36, 24, 0.16)",
  borderRadius: "12px",
  font: "inherit",
  minHeight: "44px",
  padding: "10px 12px",
  width: "100%",
};

export const fieldLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: "8px",
};

export const submitButtonStyle: React.CSSProperties = {
  background: "#102418",
  border: 0,
  borderRadius: "999px",
  color: "#eff5ef",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  padding: "12px 18px",
};
