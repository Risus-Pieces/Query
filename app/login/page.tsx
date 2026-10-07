import { RadarIcon } from "@/components/icons";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="login">
      <div className="app-icon">
        <RadarIcon size={38} />
      </div>
      <h1>Query</h1>
      <p>Private dashboard. Enter your password to continue.</p>
      <LoginForm />
    </main>
  );
}
