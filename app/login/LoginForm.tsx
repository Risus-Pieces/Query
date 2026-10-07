"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action}>
      <input
        className="field"
        type="password"
        name="password"
        placeholder="Password"
        autoComplete="current-password"
        autoFocus
        required
      />
      {state?.error ? <p className="error">{state.error}</p> : null}
      <button className="btn primary" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
