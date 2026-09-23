import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-4xl font-bold text-slate-900">404</h1>
      <p className="mt-2 text-slate-500">This page doesn't exist.</p>
      <Link href="/"><Button className="mt-6">Back to Home</Button></Link>
    </div>
  );
}
