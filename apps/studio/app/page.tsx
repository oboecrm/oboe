import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        background:
          "radial-gradient(circle at top left, rgba(218, 240, 229, 0.85), rgba(244, 243, 236, 0.92) 45%, rgba(255, 255, 255, 1) 100%)",
        color: "#102418",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        minHeight: "100vh",
        padding: "48px",
      }}
    >
      <p style={{ color: "#476452", marginTop: 0 }}>
        OboeCRM v1 architecture shell
      </p>
      <h1 style={{ fontSize: "3rem", marginBottom: "0.75rem", marginTop: 0 }}>
        Payload-like DX without putting Next.js in the core runtime
      </h1>
      <p style={{ lineHeight: 1.7, maxWidth: 760 }}>
        The studio package is the official Next.js shell. Oboe core, REST,
        GraphQL, jobs, and admin views are mounted here through shared runtime
        contracts.
      </p>
      <Link href="/admin">Open admin</Link>
    </main>
  );
}
