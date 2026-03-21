"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AuthForm() {
  const supabase = getSupabaseBrowserClient();
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    startTransition(async () => {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) {
          setMessage(error.message);
          return;
        }
        setMessage("Signed up. If email confirmation is enabled, confirm then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          setMessage(error.message);
          return;
        }
        router.push("/");
        router.refresh();
      }
    });
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>{isSignUp ? "Create account" : "Sign in"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
          />
          <Button type="submit" className="w-full" disabled={isPending}>
            {isSignUp ? "Sign up" : "Sign in"}
          </Button>
        </form>
        <button
          type="button"
          className="mt-3 text-sm text-slate-600 underline"
          onClick={() => setIsSignUp((current) => !current)}
        >
          {isSignUp ? "Have an account? Sign in" : "Need an account? Sign up"}
        </button>
        {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
