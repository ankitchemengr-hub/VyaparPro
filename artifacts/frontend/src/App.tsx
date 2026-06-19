import React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Catalog from "@/pages/catalog";
import Billing from "@/pages/billing";
import Invoices from "@/pages/invoices";
import InvoiceDetail from "@/pages/invoice-detail";
import Inventory from "@/pages/inventory";
import Customers from "@/pages/customers";
import CustomerProfile from "@/pages/customer-profile";
import Payments from "@/pages/payments";
import Rewards from "@/pages/rewards";
import Manufacturing from "@/pages/manufacturing";
import Purchases from "@/pages/purchases";
import Reports from "@/pages/reports";
import Settings from "@/pages/settings";
import Users from "@/pages/users";
import Accounts from "@/pages/accounts";
import CashBook from "@/pages/cashbook";
import Workers from "@/pages/workers";
import Expenses from "@/pages/expenses";
import Bom from "@/pages/bom";
import MyOrders from "@/pages/my-orders";
import CustomerOrdersAdmin from "@/pages/customer-orders";
import Subscriptions from "@/pages/subscriptions";
import Menu from "@/pages/menu";
import SalesmanOrders from "@/pages/salesman-orders";
import Commission from "@/pages/commission";
import BackupRestore from "@/pages/backup-restore";
import PriceList from "@/pages/price-list";
import Quotations from "@/pages/quotations";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/menu" component={Menu} />
        <Route path="/catalog" component={Catalog} />
        <Route path="/salesman-orders" component={SalesmanOrders} />
        <Route path="/commission" component={Commission} />
        <Route path="/billing" component={Billing} />
        <Route path="/invoices" component={Invoices} />
        <Route path="/invoices/:id" component={InvoiceDetail} />
        <Route path="/quotations" component={Quotations} />
        <Route path="/inventory" component={Inventory} />
        <Route path="/customers" component={Customers} />
        <Route path="/customers/:id" component={CustomerProfile} />
        <Route path="/payments" component={Payments} />
        <Route path="/rewards" component={Rewards} />
        <Route path="/manufacturing" component={Manufacturing} />
        <Route path="/bom" component={Bom} />
        <Route path="/purchases" component={Purchases} />
        <Route path="/reports" component={Reports} />
        <Route path="/accounts" component={Accounts} />
        <Route path="/cashbook" component={CashBook} />
        <Route path="/workers" component={Workers} />
        <Route path="/expenses" component={Expenses} />
        <Route path="/settings" component={Settings} />
        <Route path="/backup-restore" component={BackupRestore} />
        <Route path="/price-list" component={PriceList} />
        <Route path="/users" component={Users} />
        <Route path="/my-orders" component={MyOrders} />
        <Route path="/customer-orders" component={CustomerOrdersAdmin} />
        <Route path="/subscriptions" component={Subscriptions} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/*" component={ProtectedRoutes} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
