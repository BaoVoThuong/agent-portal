"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import styles from "../../signin/signin.module.css"; // Dùng chung style cho đồng bộ

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const message =
    error === "AccessDenied"
      ? "You do not have permission to sign in. Please contact your administrator if you believe this is an error."
      : "Sign in could not be completed. Please try again or contact your administrator.";

  return (
    <main className={styles.page}>
      <div className={styles.card} style={{ textAlign: "center" }}>
        <div style={{ fontSize: "64px", marginBottom: "20px" }}>🚫</div>
        <h1 className={styles.title} style={{ color: "#e11d48" }}>Access Denied</h1>
        <p className={styles.subtitle} style={{ marginBottom: "32px", fontSize: "16px" }}>
          {message}
        </p>

        <Link href="/signin" className={styles.submitButton} style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
          Back to Login
        </Link>
      </div>
    </main>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <div className={styles.card} style={{ textAlign: "center" }}>
            <h1 className={styles.title} style={{ color: "#e11d48" }}>
              Access Denied
            </h1>
          </div>
        </main>
      }
    >
      <AuthErrorContent />
    </Suspense>
  );
}
