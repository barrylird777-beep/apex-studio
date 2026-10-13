(() => {
  const gate = document.getElementById("owner-auth-gate");
  const form = document.getElementById("owner-auth-form");
  const password = document.getElementById("owner-auth-password");
  const status = document.getElementById("owner-auth-status");
  const signOut = document.getElementById("owner-sign-out");
  if (!gate || !form || !password || !status) return;

  const setSignedIn = value => {
    gate.hidden = Boolean(value);
    if (signOut) signOut.hidden = !value;
  };

  async function checkSession() {
    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin"
      });
      const data = await response.json();
      if (!response.ok) throw new Error("Could not check the sign-in session.");
      if (!data.configured) {
        form.hidden = true;
        status.textContent = "Owner sign-in is ready in the code, but APEX_OWNER_PASSWORD must be set privately in the deployment settings (at least 24 characters).";
        setSignedIn(false);
        return;
      }
      form.hidden = false;
      if (data.authenticated) {
        status.textContent = "";
        setSignedIn(true);
      } else {
        status.textContent = "Enter your owner passphrase to continue.";
        setSignedIn(false);
        password.focus();
      }
    } catch {
      form.hidden = true;
      status.textContent = "The sign-in service could not be reached. Check the connection and reload.";
      setSignedIn(false);
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = "Verifying owner access…";
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.value }),
        cache: "no-store",
        credentials: "same-origin"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign-in failed.");
      password.value = "";
      status.textContent = "";
      setSignedIn(true);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Sign-in failed. Try again.";
    } finally {
      submit.disabled = false;
    }
  });

  if (signOut) signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin"
      });
    } finally {
      password.value = "";
      setSignedIn(false);
      status.textContent = "You have signed out.";
      form.hidden = false;
      signOut.disabled = false;
    }
  });

  checkSession();
})();
