import { Switch, Route } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/contexts/auth-context";
import Home from "@/pages/home";
import Pricing from "@/pages/pricing";
import Contact from "@/pages/contact";
import Register from "@/pages/register";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Subscription from "@/pages/subscription";
import Payments from "@/pages/payments";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1 },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/contact" component={Contact} />
      <Route path="/register" component={Register} />
      <Route path="/login" component={Login} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/subscription" component={Subscription} />
      <Route path="/payments" component={Payments} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
      </AuthProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
