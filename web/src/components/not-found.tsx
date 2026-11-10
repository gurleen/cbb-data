import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="font-mono text-2xl">404</p>
      <p className="mt-1 text-muted-foreground">That page doesn't exist.</p>
      <Link to="/" className="mt-4 inline-block">
        Go home
      </Link>
    </div>
  );
}
