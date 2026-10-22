"use client";
import { safeNext } from "../lib/auth-navigation";
import { useState } from "react";
import { Navigate, Link, useLocation, useNavigate } from "../lib/navigation";

import PasswordInput from "../components/PasswordInput.jsx";
import { Alert, errorMessage } from "../components/ui";
import useAuthStore from "../store/useAuthStore";
import { toAsciiDigits } from "../utils/iranianFields";

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading, sessionExpired, isAuthenticated } = useAuthStore();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);

  const redirectTo = safeNext(new URLSearchParams(location.search).get("next"));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    const result = await login(identifier.trim(), password);
    if (result.success) {
      navigate(redirectTo, { replace: true });
    } else {
      setError(errorMessage(result.error));
    }
  };

  if (isAuthenticated) return <Navigate to={redirectTo} replace />;

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>ورود به کازین گالری</h1>
        <label className="field">
          <span>شماره موبایل یا ایمیل</span>
          <input
            type="text"
            dir="ltr"
            value={identifier}
            autoComplete="username"
            inputMode="tel"
            onChange={(e) => setIdentifier(toAsciiDigits(e.target.value))}
            required
          />
        </label>
        <label className="field">
          <span>رمز عبور</span>
          <PasswordInput
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {sessionExpired ? (
          <Alert>نشست شما به پایان رسیده است؛ برای ادامه دوباره وارد شوید.</Alert>
        ) : location.state?.from ? (
          <Alert>برای ادامه، ابتدا وارد شوید.</Alert>
        ) : null}

        {error ? <Alert>{error}</Alert> : null}

        <button type="submit" className="btn btn--primary btn--block" disabled={isLoading}>
          {isLoading ? "در حال ورود…" : "ورود"}
        </button>

        <div className="auth-card__links">
          <Link to="/password-reset/">رمز عبور را فراموش کرده‌اید؟</Link>
          <Link to={`/register/?next=${encodeURIComponent(redirectTo)}`}>حساب ندارید؟ ثبت‌نام</Link>
        </div>
      </form>
    </div>
  );
}

export default LoginPage;
